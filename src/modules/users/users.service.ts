import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async create(userData: Partial<User>) {
    return this.userModel.create(userData);
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async findByUsername(username: string) {
    return this.userModel.findOne({ username });
  }

  async findById(id: string) {
    return this.userModel.findById(id);
  }

  async updateById(id: string, userData: Partial<User>) {
    return this.userModel.findByIdAndUpdate(id, userData, {
      returnDocument: 'after',
    });
  }
}
