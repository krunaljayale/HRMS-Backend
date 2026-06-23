import { Injectable, Logger } from '@nestjs/common';
import { getMessaging, Message } from 'firebase-admin/messaging';

export interface SendNotificationDto {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    sound?: string;
    channelId?: string;
}

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    async sendToEmployee(payload: SendNotificationDto): Promise<boolean> {
        if (!payload.token) {
            this.logger.warn('Cannot send notification: FCM token is missing.');
            return false;
        }

        const message: Message = {
            token: payload.token,
            android: {
                notification: {
                    title: payload.title,
                    body: payload.body,
                    sound: payload.sound || 'default',
                    channelId: payload.channelId || 'hrms-general-alerts',
                },
            },
            notification: {
                title: payload.title,
                body: payload.body,
            },
            data: payload.data || {},
        };

        try {
            const response = await getMessaging().send(message);
            // this.logger.log(`Notification sent successfully to ${payload.token.substring(0, 10)}... | MessageID: ${response}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send notification: ${error.message}`, error.stack);

            if (error.code === 'messaging/registration-token-not-registered') {
                this.logger.warn('Token is no longer valid. Consider removing it from the database.');
            }

            return false;
        }
    }
}