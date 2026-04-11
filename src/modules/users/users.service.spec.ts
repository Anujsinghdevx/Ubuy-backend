import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

describe('UsersService', () => {
  let service: UsersService;

  const userModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should create user with provided payload', async () => {
    userModel.create.mockResolvedValue({ _id: 'u1' } as never);

    const payload = {
      email: 'user@ubuy.dev',
      username: 'user_1',
      isVerified: false,
    };

    await expect(service.create(payload)).resolves.toEqual({ _id: 'u1' });
    expect(userModel.create).toHaveBeenCalledWith(payload);
  });

  it('should find user by email', async () => {
    userModel.findOne.mockResolvedValue({ _id: 'u2' } as never);

    await expect(service.findByEmail('email@ubuy.dev')).resolves.toEqual({
      _id: 'u2',
    });
    expect(userModel.findOne).toHaveBeenCalledWith({ email: 'email@ubuy.dev' });
  });

  it('should find user by username', async () => {
    userModel.findOne.mockResolvedValue({ _id: 'u3' } as never);

    await expect(service.findByUsername('user_three')).resolves.toEqual({
      _id: 'u3',
    });
    expect(userModel.findOne).toHaveBeenCalledWith({ username: 'user_three' });
  });

  it('should update user by id and return updated document', async () => {
    userModel.findByIdAndUpdate.mockResolvedValue({
      _id: 'u4',
      name: 'Updated Name',
    } as never);

    await expect(
      service.updateById('u4', { name: 'Updated Name' }),
    ).resolves.toEqual({
      _id: 'u4',
      name: 'Updated Name',
    });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'u4',
      { name: 'Updated Name' },
      { returnDocument: 'after' },
    );
  });
});
