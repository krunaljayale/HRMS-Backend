import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GlobalAlert, GlobalAlertDocument } from './alert.schema';
import { UpsertAlertDto } from './dto/upsert-alert.dto';
import { CheckAlertDto } from './dto/check-alert.dto';

@Injectable()
export class AlertService {
  constructor(
    @InjectModel(GlobalAlert.name) private alertModel: Model<GlobalAlertDocument>,
  ) { }

  // ── ADMIN FEATURE: UPSERT ALERT (Singleton Pattern) ──
  async upsertAlert(alertData: UpsertAlertDto) {
    // We pass an empty filter {} so it always targets the very first document it finds.
    // upsert: true means it will create the document if it doesn't exist yet.
    return this.alertModel.findOneAndUpdate(
      {},
      { $set: alertData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  // ── MOBILE APP FEATURE: CHECK ALERT ──
  async checkAlert(dto: CheckAlertDto) {
    const { platform, versionCode } = dto;

    const alert = await this.alertModel.findOne({ isActive: true }).exec();

    // If no alert exists or it is turned off, return nothing
    if (!alert) return null;

    // If the alert is platform-specific, ensure it matches the requesting app
    if (alert.platform !== 'both' && alert.platform !== platform) {
      return null;
    }

    // Check for Force Update (User's app is too old)
    if (alert.minimumVersionCode && versionCode < alert.minimumVersionCode) {
      return alert;
    }

    // If version is completely fine, return nothing so the app continues loading
    return null;
  }
}