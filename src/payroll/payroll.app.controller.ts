import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  Get,
  Query,
  Param,
  Res
} from '@nestjs/common';
import type { Response } from 'express';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetPayrollListQueryDto } from './dto/get-payroll-list.dto';

@UseGuards(JwtAuthGuard)
@Controller('api/app/payroll')
export class PayrollAppController {
  constructor(private readonly payrollService: PayrollService) { }

  // ─── GENERATE PAYROLL ENDPOINT ───
  @Post('generate')
  async generatePayroll(@Req() req: any, @Body() body: any) {
    const { employeeId, month, year, startDate, endDate } = body;

    // 1. Validation Safeguard
    if (!employeeId) {
      throw new BadRequestException('employeeId is required');
    }

    let fromDate: Date;
    let toDate: Date;
    let targetMonth: number;
    let targetYear: number;

    // 2. Parse Custom Dates or fallback to the standard 21st-20th cycle
    if (startDate && endDate) {
      // Force UTC boundaries to prevent unexpected day shifting across time zones
      fromDate = new Date(`${startDate}T00:00:00Z`);
      toDate = new Date(`${endDate}T23:59:59Z`);
      targetMonth = toDate.getUTCMonth() + 1;
      targetYear = toDate.getUTCFullYear();
    } else if (month && year) {
      // Standard cycle logic (21st of previous month to 20th of target month)
      fromDate = new Date(Date.UTC(year, month - 2, 21, 0, 0, 0));
      toDate = new Date(Date.UTC(year, month - 1, 20, 23, 59, 59));
      targetMonth = Number(month);
      targetYear = Number(year);
    } else {
      throw new BadRequestException('Either explicit startDate/endDate or month/year is required');
    }

    // 3. Trigger the decoupled business engine
    const processedById = req.user.id || req.user._id; // Safely get the acting HR/Admin ID from JWT

    const payroll = await this.payrollService.generateSingleEmployeePayroll(
      employeeId,
      fromDate,
      toDate,
      targetMonth,
      targetYear,
      processedById
    );

    return {
      statusCode: 200,
      data: payroll,
      message: 'Payroll generated and locked successfully.',
    };
  }

  @Get('list')
  async getPayrollList(@Req() req: any, @Query() query: GetPayrollListQueryDto) {
    const result = await this.payrollService.getPayrollList(req.user, query);

    return {
      statusCode: 200,
      data: result,
      message: 'Payrolls fetched successfully'
    };
  }

  // ── EMPLOYEE PREVIEW ENDPOINT ──
  @Post('preview')
  async previewMyPayroll(@Req() req: any, @Body() body: any) {
    // 1. Extract and Validate
    const targetEmployeeId = req.user.employeeId;
    const { startDate, endDate } = body;

    if (!targetEmployeeId) {
      throw new BadRequestException('targetEmployeeId is required');
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('Both startDate & endDate are required');
    }

    // 2. Parse strict YYYY-MM-DD strings from frontend into UTC boundaries
    const fromDate = new Date(`${startDate}T00:00:00+05:30`);
    const toDate = new Date(`${endDate}T23:59:59+05:30`);

    // 3. Run Simulation
    const simulation = await this.payrollService.previewEmployeePayroll(
      targetEmployeeId,
      fromDate,
      toDate
    );

    return {
      statusCode: 200,
      data: simulation,
      message: 'Preview generated successfully'
    };
  }

  @Get(':id/details')
  async getPayrollDetails(@Req() req: any, @Param('id') payrollId: string) {
    const targetEmployeeId = req.user.employeeId;

    if (!targetEmployeeId) {
      throw new BadRequestException('targetEmployeeId is required in token');
    }

    if (!payrollId) {
      throw new BadRequestException('Payroll ID is required');
    }

    const details = await this.payrollService.getHistoricalPayrollDetails(
      payrollId,
      targetEmployeeId
    );

    return {
      statusCode: 200,
      data: details,
      message: 'Statement details fetched successfully',
    };
  }

  @Get(':id/download')
  async downloadPayslip(
    @Param('id') payrollId: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const employeeId = req.user.employeeId;

    // 1. Generate the PDF buffer from your service
    const pdfBuffer = await this.payrollService.generateSalarySlipPdf(payrollId, employeeId);

    // 2. Set the strict headers required for binary PDF transfer
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Payslip.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    // 3. Send the raw buffer to the client
    res.end(pdfBuffer);
  }
}