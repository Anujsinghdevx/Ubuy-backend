import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRootStatus() {
    return {
      status: 'ok',
      message: 'Ubuy backend is running',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      endpoints: {
        health: '/health',
        auth: '/auth',
        auctions: '/auctions',
        websocket: 'socket.io',
      },
    };
  }
}
