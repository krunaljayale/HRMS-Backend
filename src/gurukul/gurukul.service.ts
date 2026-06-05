import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type PaginateModel } from 'mongoose';
import { Video, VideoDocument } from './schema/video.schema';
import { GetVideosDto } from './dto/get-videos.dto';

@Injectable()
export class GurukulService {
  constructor(
    // We use PaginateModel instead of the standard Model to unlock the .paginate() method
    @InjectModel(Video.name) private videoModel: PaginateModel<VideoDocument>,
  ) { }

  async getPaginatedVideos(queryDto: GetVideosDto) {
    const { page = 1, limit = 10, search } = queryDto;

    // 1. Base query: Only fetch videos that are active
    const query: any = { isActive: true };

    // 2. Search filter: If user types a search, match it against the title
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    // 3. Pagination & Population Options
    const options = {
      page,
      limit,
      sort: { createdAt: -1 }, // Show newest videos first
      // Automatically pull in the author's name and photo from the Employee collection
      populate: { path: 'createdBy', select: 'name profileImageUrl' },
    };

    // 4. Execute the plugin
    return await this.videoModel.paginate(query, options);
  }
}