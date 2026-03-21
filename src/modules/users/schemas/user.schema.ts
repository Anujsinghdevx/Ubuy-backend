import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ unique: true, sparse: true })
  username?: string;

  @Prop()
  password?: string;

  @Prop()
  name?: string;

  @Prop()
  image?: string;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop()
  googleId?: string;

  @Prop({ default: 'local' })
  provider: 'local' | 'google';

  @Prop({ default: [] })
  biddedAuctions: string[];

  @Prop()
  verificationCode?: string;

  @Prop()
  verificationCodeExpiry?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
