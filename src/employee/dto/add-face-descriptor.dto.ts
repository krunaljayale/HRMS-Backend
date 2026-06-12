import { IsArray, IsString } from 'class-validator';

export class CreateFaceDto {
    @IsArray()
    faceDescriptors!: number[][];

    @IsString()
    image!: string;
}