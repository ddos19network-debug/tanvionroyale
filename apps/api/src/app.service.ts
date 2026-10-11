import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getApiInfo(): { name: string; version: string; docs: string } {
    return {
      name: 'TANVIONROYALE API',
      version: '0.1.0',
      docs: '/docs',
    };
  }
}