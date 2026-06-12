import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemConfig, SystemConfigDocument } from './schemas/system-config.schema';

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectModel(SystemConfig.name) private systemConfigModel: Model<SystemConfigDocument>,
  ) {}

  async getActiveConfig() {
    // 1. Fetch the single config document
    let config = await this.systemConfigModel.findOne().exec();

    // 2. Auto-seed the database if it is empty
    if (!config) {
      config = await this.systemConfigModel.create({
        officeLat: 18.5339582,
        officeLon: 73.839535,
        radiusMeters: 50,
        defaultShiftHours: 8.5,
        saturdayShiftHours: 7.0,
      });
    }

    // 3. Calculate today's exact shift hours based on the SERVER'S timezone
    const serverDate = new Date();
    const isSaturday = serverDate.getDay() === 6;
    
    const activeShiftHours = isSaturday ? config.saturdayShiftHours : config.defaultShiftHours;

    // 4. Map the MongoDB document to the exact JSON structure the React Native app expects
    return {
      office_lat: config.officeLat,
      office_lon: config.officeLon,
      radius_meters: config.radiusMeters,
      shift_hours: activeShiftHours, 
    };
  }
}