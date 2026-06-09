import { IsMongoId, IsNotEmpty } from 'class-validator';

export class CreateCompOffLedgerDto {
    @IsMongoId()
    @IsNotEmpty()
    attendanceId!: string;
}