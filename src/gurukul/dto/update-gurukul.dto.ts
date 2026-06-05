import { PartialType } from '@nestjs/swagger';
import { CreateGurukulDto } from './create-gurukul.dto';

export class UpdateGurukulDto extends PartialType(CreateGurukulDto) {}
