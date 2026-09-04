import { NestFactory } from '@nestjs/core';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { AppModule } from './app.module';
import { NotificationService } from './notification/notification.service';

const serviceAccount = require('./notification/fcm-config/firebase-adminsdk.json');

async function run() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
    });
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const notificationService = app.get(NotificationService);

  const isSent = await notificationService.sendToEmployee({
    token: 'eBIEzBllQsGVwJftnqiDAo:APA91bGaZCPao4OZQsulvCMqnc6M6bCCJgoRcGrFuGo7R5jp1j7NFRIWVBRfaQ-mPnfJ9QMri3GZTAiYs4lo2s-vGfv3iZ-attxqCB634yEw-62Mnr_fUMo',
    title: '⚠️ Attendance Alert: Invalid Check-in Location',
    body: "Your check-in was detected outside designated office premises. Today's attendance will not be counted toward payroll. For discrepancies, contact your reporting manager.",
    channelId: 'hrms-attendance-alerts',
    data: {
      type: 'ATTENDANCE_LOCATION_MISMATCH',
      severity: 'HIGH',
      action: 'CONTACT_MANAGER',
    },
  });

  console.log(`Notification sent: ${isSent}`);
  await app.close();
}

run();