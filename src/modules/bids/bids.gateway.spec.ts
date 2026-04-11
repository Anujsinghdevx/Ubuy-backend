import { WsException } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { BidsGateway } from './bids.gateway';
import { BidsService } from './bids.service';

describe('BidsGateway', () => {
  let gateway: BidsGateway;
  const bidsService = {
    placeBid: jest.fn(),
  };
  const jwtServiceMock = {
    verify: jest.fn(),
  };
  const jwtService = jwtServiceMock as unknown as JwtService;

  const buildClient = (overrides: Partial<any> = {}) => ({
    id: 'socket-1',
    conn: { transport: { name: 'websocket' } },
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    ...overrides,
    handshake: {
      auth: {},
      query: {},
      headers: {},
      ...(overrides.handshake ?? {}),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new BidsGateway(bidsService as never, jwtService);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      engine: { on: jest.fn() },
    } as never;
  });

  it('should join auction and user rooms when auth token is present', async () => {
    jwtServiceMock.verify.mockReturnValue({ sub: 'user-1', email: 'user@ubuy.dev' });
    const client = buildClient({
      handshake: { auth: { token: 'token' } },
    });

    await expect(gateway.handleJoinAuction({ auctionId: 'auction-1' }, client as never)).resolves.toEqual({
      message: 'Joined auction auction-1',
    });
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.join).toHaveBeenCalledWith('auction-1');
  });

  it('should leave auction room', async () => {
    const client = buildClient();

    await expect(gateway.handleLeaveAuction('auction-1', client as never)).resolves.toEqual({
      message: 'Left auction auction-1',
    });
    expect(client.leave).toHaveBeenCalledWith('auction-1');
  });

  it('should place bid and invoke ack callback on success', async () => {
    jwtServiceMock.verify.mockReturnValue({ sub: 'user-1', email: 'user@ubuy.dev' });
    bidsService.placeBid.mockResolvedValue({ _id: 'auction-1' });
    const client = buildClient({
      handshake: { auth: { token: 'token' } },
    });
    const ack = jest.fn();

    await expect(
      gateway.handlePlaceBid(client as never, { auctionId: 'auction-1', amount: '100' }, ack),
    ).resolves.toBeUndefined();
    expect(bidsService.placeBid).toHaveBeenCalledWith('user-1', 'auction-1', 100);
    expect(ack).toHaveBeenCalledWith({ ok: true, data: { _id: 'auction-1' } });
  });

  it('should reject place bid when user token is missing', async () => {
    const client = buildClient();

    await expect(
      gateway.handlePlaceBid(client as never, { auctionId: 'auction-1', amount: 100 }, undefined),
    ).rejects.toBeInstanceOf(WsException);
  });
});
