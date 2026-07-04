import { Injectable } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
    async uploadFile(
        file: Express.Multer.File,
        folderName: string = 'employee_documents'
    ): Promise<UploadApiResponse | UploadApiErrorResponse> {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: folderName,
                    resource_type: 'auto', // Automatically detects images vs PDFs
                },
                (error, result: any) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );

            // Create a stream out of the file buffer and pipe it to Cloudinary
            const stream = new Readable();
            stream.push(file.buffer);
            stream.push(null);
            stream.pipe(uploadStream);
        });
    }
}