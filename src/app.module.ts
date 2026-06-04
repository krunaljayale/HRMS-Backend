import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeeModule } from './employee/employee.module';
import { LeaveModule } from './leave/leave.module';
import { AlertModule } from './alert/alert.module';

@Module({
  imports: [
    // 1. Initialize the Config Module to be globally available
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. Initialize Mongoose asynchronously using the Config Service
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),

    EmployeeModule,

    LeaveModule,

    AlertModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }