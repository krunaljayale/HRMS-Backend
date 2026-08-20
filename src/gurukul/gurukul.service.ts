import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type PaginateModel } from 'mongoose';
import { Video, VideoDocument } from './schemas/video.schema';
import { GetVideosDto } from './dto/get-videos.dto';
import { CreateVideoDto, UpdateVideoDto } from './dto/create-gurukul.dto';
import { HrService } from '../hr/hr.service';

@Injectable()
export class GurukulService {
  constructor(
    @InjectModel(Video.name) private videoModel: PaginateModel<VideoDocument>,
    @Inject(forwardRef(() => HrService)) 
    private readonly hrService: HrService,
  ) { }

  // --- FETCH VIDEOS (ADMIN) ---
  async getPaginatedVideos(queryDto: GetVideosDto) {
    const { page = 1, limit = 10, search } = queryDto;

    // Base query: Empty to fetch BOTH active and inactive for the Admin Dashboard
    const query: any = {};

    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const options = {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: { path: 'createdBy', select: 'name profileImageUrl' },
    };

    return await this.videoModel.paginate(query, options);
  }

  // --- CREATE VIDEO ---
  async createVideo(createVideoDto: CreateVideoDto) {
    // 1. Fetch the master HR profile
    const hrProfile = await this.hrService.getMasterProfile();
    
    // 2. Extract the employee _id from the nested employeeAccount object
    const hrEmployeeId = hrProfile.employeeAccount._id;

    // 3. Create the video using this ID
    const newVideo = new this.videoModel({
      ...createVideoDto,
      createdBy: hrEmployeeId, 
    });
    
    return await newVideo.save();
  }

  // --- UPDATE VIDEO ---
  async updateVideo(id: string, updateVideoDto: Partial<UpdateVideoDto>) {
    const updatedVideo = await this.videoModel.findByIdAndUpdate(
      id,
      updateVideoDto,
      { new: true, runValidators: true } // Return the updated document
    ).populate('createdBy', 'name profileImageUrl');

    if (!updatedVideo) {
      throw new NotFoundException(`Video with ID ${id} not found`);
    }
    return updatedVideo;
  }

  // --- DELETE VIDEO ---
  async deleteVideo(id: string) {
    const deletedVideo = await this.videoModel.findByIdAndDelete(id);
    if (!deletedVideo) {
      throw new NotFoundException(`Video with ID ${id} not found`);
    }
    return { message: 'Video deleted successfully', id };
  }
}