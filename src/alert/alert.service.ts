import { forwardRef, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GlobalAlert, GlobalAlertDocument } from './schemas/alert.schema';
import { UpsertAlertDto } from './dto/upsert-alert.dto';
import { CheckAlertDto } from './dto/check-alert.dto';
import { EmployeeService } from '../employee/employee.service';
import { HrService } from '../hr/hr.service';

@Injectable()
export class AlertService {
  private readonly PRIORITY_WEIGHTS: Record<string, number> = {
    force_update: 100,
    maintenance: 75,
    optional_update: 50,
    promo: 25,
    info: 10,
  };

  constructor(
    @InjectModel(GlobalAlert.name) private alertModel: Model<GlobalAlertDocument>,
    private readonly employeeService: EmployeeService,
    @Inject(forwardRef(() => HrService)) private readonly hrService: HrService,
  ) { }


  // ── ADMIN FEATURE: UPSERT ALERT ──
  async upsertAlert(alertData: UpsertAlertDto) {
    // 1. Call your existing method to securely get the Master HR Profile
    const hrProfile = await this.hrService.getMasterProfile();

    // Extract the raw ObjectId string from the populated account
    const employeeId = hrProfile.employeeAccount._id.toString();

    // 2. Fetch the employee record to verify roles
    const employee = await this.employeeService.getEmployeeById(employeeId);

    if (!employee) {
      throw new UnauthorizedException('User not found.');
    }

    const isAppAdmin = employee.isAppAdmin;

    // 3. SECURITY RULE: Only AppAdmins can post technical/app-breaking alerts
    const technicalTypes = ['force_update', 'optional_update', 'maintenance'];
    if (alertData.type && technicalTypes.includes(alertData.type)) {
      if (!isAppAdmin) {
        throw new UnauthorizedException(
          'SYSTEM_LOCKED: Only users with AppAdmin privileges can trigger version updates.'
        );
      }
    }

    // Notice: We completely removed the HR restriction block here. 
    // Normal announcements ('info', 'promo') will now pass straight through!

    // ── DATA TRANSFORMATION ──
    const payloadToSave: any = { ...alertData };

    if (alertData.buttonLink && alertData.buttonLink.trim() !== '') {
      payloadToSave.buttonLink = {
        android: alertData.buttonLink,
        ios: alertData.buttonLink,
      };
    } else {
      payloadToSave.buttonLink = null;
    }

    if (!alertData.imageUrl || alertData.imageUrl.trim() === '') {
      payloadToSave.imageUrl = null;
    }

    // Save to Database
    return this.alertModel.findOneAndUpdate(
      { type: alertData.type },
      { $set: payloadToSave },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    ).exec();
  }

  // ── MOBILE APP FEATURE: CHECK ALERT (PRIORITY QUEUE) ──
  async checkAlert(dto: CheckAlertDto) {
    const { platform, versionCode } = dto;

    // 1. Fetch ALL active alerts from the database
    const activeAlerts = await this.alertModel.find({ isActive: true }).exec();

    if (!activeAlerts.length) return null;

    // 2. Filter out alerts that do not apply to this specific user's app instance
    const validAlerts = activeAlerts.filter(alert => {
      // Reject if platforms do not match
      if (alert.platform !== 'both' && alert.platform !== platform) return false;

      // Logic for Update Alerts: Only show if user's app is strictly older than the minimum required
      if (alert.type === 'force_update' || alert.type === 'optional_update') {
        if (alert.minimumVersionCode && versionCode >= alert.minimumVersionCode[platform]) {
          return false;
        }
      }

      return true;
    });

    if (!validAlerts.length) return null;

    // 3. Sort the remaining valid alerts by weight (Descending order)
    validAlerts.sort((a, b) => {
      const weightA = this.PRIORITY_WEIGHTS[a.type] || 0;
      const weightB = this.PRIORITY_WEIGHTS[b.type] || 0;
      return weightB - weightA; // Highest weight goes to index 0
    });

    // 4. Return ONLY the single most important alert to match your React Native routing behavior
    return validAlerts[0];
  }

  // ── WEB ADMIN FEATURE: GET ALERTS ──
  async getWebAlerts() {
    // Only fetch announcement types relevant to the web portal (hide technical updates)
    return this.alertModel.find({
      type: { $in: ['info', 'promo'] }
    }).sort({ updatedAt: -1 }).exec();
  }
}