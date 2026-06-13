import { Controller, Post, Get, Patch, Body, Req, Param, UseGuards } from '@nestjs/common';
import { ResignationService } from './resignation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplyResignationDto } from './dto/apply-resignation.dto';

@Controller('api/app/resignation')
@UseGuards(JwtAuthGuard)
export class ResignationAppController {
  constructor(private readonly resignationService: ResignationService) { }

  @Post('apply')
  async applyResignation(
    @Req() req: any,
    @Body() dto: ApplyResignationDto
  ) {
    const employeeId = req.user.employeeId;
    const data = await this.resignationService.applyResignation(employeeId, dto);

    return {
      statusCode: 201,
      data: data,
      message: 'Resignation request submitted successfully.'
    };
  }

  @Get('my-history')
  async getMyHistory(@Req() req: any) {
    const employeeId = req.user.employeeId;
    const data = await this.resignationService.getMyResignations(employeeId);

    return {
      statusCode: 200,
      data: data,
      message: 'Resignation history fetched successfully.'
    };
  }

  @Patch('withdraw/:id')
  async withdrawResignation(
    @Req() req: any,
    @Param('id') id: string
  ) {
    const employeeId = req.user.employeeId;
    const data = await this.resignationService.withdrawResignation(employeeId, id);

    return {
      statusCode: 200,
      data: data,
      message: 'Resignation request withdrawn successfully.'
    };
  }
}