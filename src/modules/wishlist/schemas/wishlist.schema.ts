import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WishlistDocument = Wishlist & Document;

@Schema({ timestamps: true })
export class Wishlist {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  auctionId: string;

  createdAt?: Date;

  updatedAt?: Date;
}

export const WishlistSchema = SchemaFactory.createForClass(Wishlist);

WishlistSchema.index({ userId: 1, auctionId: 1 }, { unique: true });
