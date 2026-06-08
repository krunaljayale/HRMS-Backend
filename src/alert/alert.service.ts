import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GlobalAlert, GlobalAlertDocument } from './schemas/alert.schema';
import { UpsertAlertDto } from './dto/upsert-alert.dto';
import { CheckAlertDto } from './dto/check-alert.dto';
import { EmployeeService } from '../employee/employee.service';

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
  ) { }


  // ── ADMIN FEATURE: UPSERT ALERT BY TYPE WITH SECURITY ──
  async upsertAlert(alertData: UpsertAlertDto, id: string) {

    // 1. Fetch the requestor's employee record
    const employee = await this.employeeService.getEmployeeById(id, 'role isAppAdmin');

    const requestorRole = employee.role;
    const isAppAdmin = employee.isAppAdmin;

    //  RULE 1: Technical Updates (Force / Optional)
    if (alertData.type === 'force_update' || alertData.type === 'optional_update' || alertData.type === 'maintenance') {
      if (!isAppAdmin) {
        throw new UnauthorizedException(
          'Only users with AppAdmin privileges can trigger version updates.'
        );
      }
    }

    //  RULE 2: HR Announcements (Info / Promo )
    if (!isAppAdmin && requestorRole !== 'HR') {
      throw new UnauthorizedException(
        'You must be an HR Administrator to post company announcements.'
      );
    }

    //  Save to database
    return this.alertModel.findOneAndUpdate(
      { type: alertData.type },
      { $set: alertData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
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
}