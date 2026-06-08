import { IsNumber, IsNotEmpty } from 'class-validator';

export class TrackLocationDto {
    @IsNumber()
    @IsNotEmpty()
    latitude!: number;

    @IsNumber()
    @IsNotEmpty()
    longitude!: number;
}