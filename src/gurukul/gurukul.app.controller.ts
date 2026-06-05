import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GurukulService } from './gurukul.service';
import { GetVideosDto } from './dto/get-videos.dto';

@Controller('api/app/gurukul')
export class GurukulAppController {
  constructor(private readonly gurukulService: GurukulService) { }

  @Get('videos')
  @UseGuards(JwtAuthGuard)
  async getVideos(@Query() queryDto: GetVideosDto) {

    const paginatedData = await this.gurukulService.getPaginatedVideos(queryDto);

    return {
      success: true,
      message: 'Videos fetched successfully',
      data: paginatedData,
    };
  }
}