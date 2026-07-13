// src/reimbursement/reimbursement.app.controller.ts

import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  Req,
  BadRequestException,
  UseGuards,
  Get,
  Delete,
  Param
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReimbursementService } from './reimbursement.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/app/reimbursement')
export class ReimbursementAppController {
  constructor(private readonly reimbursementService: ReimbursementService) { }

  @Post('apply')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('proof'))
  async submitReimbursement(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { amount: string; reason: string; expenseDate: string },
    @Req() req: any,
  ) {
    // 1. Guard against missing files before starting any service processing
    if (!file) {
      throw new BadRequestException('A physical receipt image proof is mandatory');
    }

    // 2. Extract employeeId securely from the request context (JWT Payload) 
    const employeeId = req.user.employeeId;

    // 3. Parse incoming form-data strings into valid typed primitives
    const parsedAmount = parseFloat(body.amount);
    const parsedDate = new Date(body.expenseDate);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('Please provide a valid amount greater than 0');
    }

    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Please provide a valid expense date');
    }

    // 4. Pass sanitized parameters down to the transactional service layer
    return await this.reimbursementService.createFromApp(employeeId, {
      amount: parsedAmount,
      reason: body.reason,
      expenseDate: parsedDate,
      file,
    });
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  async getReimbursementHistory(@Req() req: any) {
    const employeeId = req.user.employeeId;

    if (!employeeId) {
      throw new BadRequestException('Authentication context missing');
    }

    return await this.reimbursementService.getEmployeeHistory(employeeId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async cancelReimbursement(@Param('id') id: string, @Req() req: any) {
    const employeeId = req.user.employeeId;
    return await this.reimbursementService.cancelEmployeeClaim(id, employeeId);
  }
}