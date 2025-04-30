// PocketMailManager.js (Expire Süresi TemplateData'dan Okuyan Sürüm)

/**
 * 📬 PocketMailManager Kullanım Örnekleri
 *
 * import PocketMailManager from './pocket-core/PocketMailManager.js';
 *
 * // Örnek bir email listesi
 * const toList = [
 *     "imuratony@gmail.com",
 *     "sehertut96@gmail.com"
 * ];
 *
 * // Kullanıcıya özel OTP kodu üretiyoruz
 * const generateOtpCode = () => Math.floor(100000 + Math.random() * 900000);
 *
 * // Her kullanıcıya mail gönderiyoruz
 * for (const email of toList) {
 *
 *     const otpCode = generateOtpCode(); // Her kullanıcıya özel OTP
 *     const username = email.split('@')[0]; // E-posta adresinin @ öncesi kısmı
 *
 *     // 1️⃣ OTP_VERIFICATION - OTP Kod Gönderimi
 *     await PocketMailManager.send({
 *         subject: "OTP Doğrulama Kodunuz",
 *         html: "", // templates/otp_verification.html kullanılacak
 *         to: email,
 *         mailType: PocketMailManager.MailType.OTP_VERIFICATION,
 *         templateData: {
 *             OTP_CODE: otpCode,
 *             USER_NAME: username,
 *             EXPIRE_SECONDS: 300 // (isteğe bağlı) OTP kodu 5 dakika geçerli olsun
 *         }
 *     });
 *
 *     // 2️⃣ PASSWORD_RESET - Şifre Sıfırlama Linki
 *     await PocketMailManager.send({
 *         subject: "Şifre Sıfırlama Talebiniz",
 *         html: "", // templates/password_reset.html kullanılacak
 *         to: email,
 *         mailType: PocketMailManager.MailType.PASSWORD_RESET,
 *         templateData: {
 *             RESET_URL: `https://api.muratonay.com.tr/reset-password?token=${otpCode}`,
 *             USER_NAME: username,
 *             EXPIRE_SECONDS: 900 // (isteğe bağlı) Şifre sıfırlama linki 15 dakika geçerli olsun
 *         }
 *     });
 *
 *     // 3️⃣ REDIRECT_ACTION - İşlem Onayı Linki
 *     await PocketMailManager.send({
 *         subject: "İşlem Onayı Gerekiyor",
 *         html: "", // templates/redirect_action.html kullanılacak
 *         to: email,
 *         mailType: PocketMailManager.MailType.REDIRECT_ACTION,
 *         templateData: {
 *             REDIRECT_URL: `https://api.muratonay.com.tr/confirm-action?token=${otpCode}`,
 *             USER_NAME: username
 *         }
 *     });
 *
 *     // 4️⃣ SYSTEM_ALERT - Kritik Sistem Uyarısı
 *     await PocketMailManager.send({
 *         subject: "Sistem Uyarısı!",
 *         html: "", // templates/system_alert.html kullanılacak
 *         to: email,
 *         mailType: PocketMailManager.MailType.SYSTEM_ALERT,
 *         templateData: {
 *             USER_NAME: username
 *         }
 *     });
 *
 *     // 5️⃣ NOTIFICATION_INFO - Basit Bilgilendirme Maili
 *     await PocketMailManager.send({
 *         subject: "Bilgilendirme: Yeni Özellikler",
 *         html: "", // templates/notification_info.html kullanılacak
 *         to: email,
 *         mailType: PocketMailManager.MailType.NOTIFICATION_INFO,
 *         templateData: {
 *             USER_NAME: username
 *         }
 *     });
 * }
 *
 */

import nodemailer from 'nodemailer';
import PocketConfigManager from './PocketConfigManager.js';
import PocketUtility from './PocketUtility.js';
import PocketMongo from './PocketMongo.js';
import PocketQueryFilter from './PocketQueryFilter.js';
import fs from 'fs';
import path from 'path';

export default class PocketMailManager {

     static MailType = {
          OTP_VERIFICATION: "OTP_VERIFICATION",
          NOTIFICATION_INFO: "NOTIFICATION_INFO",
          REDIRECT_ACTION: "REDIRECT_ACTION",
          SYSTEM_ALERT: "SYSTEM_ALERT",
          PASSWORD_RESET: "PASSWORD_RESET"
     };

     static async send({html, to, mailType = PocketMailManager.MailType.NOTIFICATION_INFO, templateData = {} }) {
          if (!to || (Array.isArray(to) && to.length === 0)) {
               throw new Error("Receiver list cannot be empty.");
          }

          const transporter = nodemailer.createTransport({
               service: 'gmail',
               auth: {
                    user: PocketConfigManager.getPocketMail(),
                    pass: PocketConfigManager.getPocketMailPass()
               }
          });

          const toField = Array.isArray(to) ? to.join(", ") : to;
          const maxRetries = PocketMailManager.getRetryLimit(mailType);
          const subject = PocketMailManager.getSubjectTemplate(mailType);

          const expireTime = templateData.EXPIRE_SECONDS
               ? new Date(Date.now() + templateData.EXPIRE_SECONDS * 1000)
               : null;

          const htmlContentBase = html || await PocketMailManager.getDefaultHtmlTemplate(mailType);
          const htmlContent = PocketMailManager.replaceTemplateVariables(htmlContentBase, templateData);

          const finalHtml = `
               <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Merhaba ${templateData.USER_NAME || 'Kullanıcı'}!</h2>
                    ${htmlContent}
                    <hr style="margin-top: 30px;">
                    <p style="font-size: 12px; color: #cccccc;">Pocket Mail System Manager tarafından gönderilmiştir. Lütfen bu e-postayı yanıtlamayınız.</p>
               </div>
          `;

          const mailOptions = {
               from: PocketConfigManager.getPocketMail(),
               to: toField,
               subject: subject,
               html: finalHtml
          };

          let attempts = 0;
          let lastError = null;
          let mailLogId = null;

          try {
               mailLogId = await PocketMailManager.insertMailLog({
                    subject,
                    to: toField,
                    html: finalHtml,
                    mailType,
                    status: "Pending",
                    retryCount: 0,
                    expireAt: expireTime
               });
          } catch (e) {
               console.error("Mail log insert failed:", e.message);
          }

          while (attempts <= maxRetries) {
               try {
                    const info = await transporter.sendMail(mailOptions);
                    const parsedResult = PocketMailManager.parseMailResponse({ sendStatus: true, info });

                    if (mailLogId) {
                         await PocketMailManager.updateMailLog(mailLogId, {
                              status: "Success",
                              smtpInfo: parsedResult
                         });
                    }

                    return {
                         sendStatus: true,
                         smtpInfo: parsedResult,
                         templateData: templateData,
                         mailType: mailType,
                         subject: subject,
                         to: Array.isArray(to) ? to : [to],
                         logId: mailLogId
                    };
               } catch (error) {
                    lastError = error;
                    attempts++;

                    if (mailLogId) {
                         await PocketMailManager.incrementRetryCount(mailLogId, attempts);
                    }

                    if (attempts > maxRetries) {
                         break;
                    }

                    console.error(`Mail sending failed. Retrying attempt ${attempts}/${maxRetries} after 1000ms...`);
                    await PocketMailManager.delay(1000);
               }
          }

          if (mailLogId) {
               await PocketMailManager.updateMailLog(mailLogId, {
                    status: "Failure",
                    errorMessage: lastError.message
               });
          }

          throw new Error(`Mail could not be sent after ${maxRetries} retries. Last error: ${lastError.message}`);
     }

     static replaceTemplateVariables(template, data) {
          let result = template;
          for (const key of Object.keys(data)) {
               const regex = new RegExp(`{{${key}}}`, 'g');
               result = result.replace(regex, data[key]);
          }
          return result;
     }

     static async loadTemplateFromFile(fileName) {
          const templatePath = path.resolve(process.cwd(), 'Util', 'MailTemplates', fileName);
          try {
               const templateContent = fs.readFileSync(templatePath, 'utf8');
               return templateContent;
          } catch (error) {
               console.error(`Template loading error: ${fileName}`, error);
               throw new Error("Template loading failed.");
          }
     }

     static async getDefaultHtmlTemplate(mailType) {
          switch (mailType) {
               case PocketMailManager.MailType.OTP_VERIFICATION:
                    return await PocketMailManager.loadTemplateFromFile('otp_verification.html');
               case PocketMailManager.MailType.PASSWORD_RESET:
                    return await PocketMailManager.loadTemplateFromFile('password_reset.html');
               case PocketMailManager.MailType.REDIRECT_ACTION:
                    return await PocketMailManager.loadTemplateFromFile('redirect_action.html');
               case PocketMailManager.MailType.SYSTEM_ALERT:
                    return await PocketMailManager.loadTemplateFromFile('system_alert.html');
               case PocketMailManager.MailType.NOTIFICATION_INFO:
                    return await PocketMailManager.loadTemplateFromFile('notification_info.html');
               default:
                    return "<p>Bilgilendirme mesajıdır.</p>";
          }
     }

     static getSubjectTemplate(mailType){
          switch (mailType) {
               case PocketMailManager.MailType.OTP_VERIFICATION:
                    return "OTP Doğrulama Kodunuz"
               case PocketMailManager.MailType.PASSWORD_RESET:
                    return "Şifre Sıfırlama Talebiniz";
               case PocketMailManager.MailType.REDIRECT_ACTION:
                    return "İşlem Onayı Gerekiyor"
               case PocketMailManager.MailType.SYSTEM_ALERT:
                    return "Sistem Uyarısı!"
               case PocketMailManager.MailType.NOTIFICATION_INFO:
                    return "Bilgilendirme: Yeni Özellikler"
               default:
                    throw new Error("Tanımsız mail tipi ile işlem yapılıyor.").stack;
          }
     }

     static getRetryLimit(mailType) {
          switch (mailType) {
               case PocketMailManager.MailType.SYSTEM_ALERT:
                    return 0;
               case PocketMailManager.MailType.OTP_VERIFICATION:
               case PocketMailManager.MailType.PASSWORD_RESET:
                    return 3;
               case PocketMailManager.MailType.REDIRECT_ACTION:
               case PocketMailManager.MailType.NOTIFICATION_INFO:
                    return 2;
               default:
                    return 2;
          }
     }

     static parseMailResponse(sendMailer) {
          if (!sendMailer || !sendMailer.info) {
               throw new Error("Invalid mail sending result.");
          }

          const info = sendMailer.info;

          return {
               status: sendMailer.sendStatus ? "Success" : "Failure",
               acceptedRecipients: info.accepted || [],
               rejectedRecipients: info.rejected || [],
               smtpServerFeatures: info.ehlo || [],
               envelopeSendTimeMs: info.envelopeTime,
               messageSendTimeMs: info.messageTime,
               messageSizeBytes: info.messageSize,
               smtpResponse: info.response,
               fromAddress: info.envelope?.from,
               toAddresses: info.envelope?.to || [],
               messageId: info.messageId
          };
     }

     static async insertMailLog(logData) {
          const dbClient = new PocketMongo();

          const params = {
               _id: PocketUtility.GenerateOID(),
               createdAt: new Date(),
               subject: logData.subject,
               to: logData.to,
               html: logData.html,
               mailType: logData.mailType,
               status: logData.status,
               smtpInfo: logData.smtpInfo || null,
               errorMessage: logData.errorMessage || null,
               retryCount: logData.retryCount || 0,
               expireAt: logData.expireAt || null
          };

          const saveResult = await new Promise((resolve, reject) => {
               dbClient.executeInsert({
                    from: "pocket.mail",
                    params: params,
                    done: resolve,
                    fail: reject
               });
          });

          return params._id;
     }

     static async updateMailLog(mailLogId, updateData) {
          const dbClient = new PocketMongo();

          const params = {
               ...updateData,
               updatedAt: new Date()
          };

          let updateFilter = new PocketQueryFilter();
          updateFilter.add("_id", mailLogId).operator("==");

          const updateResult = await new Promise((resolve, reject) => {
               dbClient.executeUpdate({
                    from: "pocket.mail",
                    params: params,
                    where: updateFilter,
                    done: resolve,
                    fail: reject
               });
          });

          return updateResult;
     }

     static async incrementRetryCount(mailLogId, attempts) {
          const dbClient = new PocketMongo();

          let updateFilter = new PocketQueryFilter();
          updateFilter.add("_id", mailLogId).operator("==");

          const updateResult = await new Promise((resolve, reject) => {
               dbClient.executeUpdate({
                    from: "pocket.mail",
                    params: { attempts: attempts },
                    where: updateFilter,
                    done: resolve,
                    fail: reject
               });
          });

          return updateResult;
     }

     static delay(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
     }
}
