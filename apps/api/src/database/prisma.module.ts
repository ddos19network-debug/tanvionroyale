import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SecondaryPrismaService } from './secondary-prisma.service';

@Global()
@Module({
  providers: [PrismaService, SecondaryPrismaService],
  exports: [PrismaService, SecondaryPrismaService],
})
export class PrismaModule {}