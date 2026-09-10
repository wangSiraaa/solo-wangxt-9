import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CertService } from './cert.service';

class UploadJsonDto {
  label: string;
  note?: string;
  pem: string;
}

@Controller('api/certificates')
export class CertController {
  constructor(private readonly certService: CertService) {}

  @Get()
  list() {
    return this.certService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.certService.get(id);
  }

  /** JSON 上传（前端粘贴 PEM 走这里） */
  @Post()
  uploadJson(@Body() dto: UploadJsonDto) {
    return this.certService.uploadChainPem(dto.pem ?? '', dto.label ?? '', dto.note ?? '');
  }

  /** multipart 文件上传，限制 256KB（证书链是纯文本小文件） */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 256 * 1024 } }),
  )
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { label?: string; note?: string },
  ) {
    if (!file) return;
    return this.certService.uploadChainPem(
      file.buffer.toString('utf8'),
      body.label ?? file.originalname,
      body.note ?? '',
    );
  }
}
