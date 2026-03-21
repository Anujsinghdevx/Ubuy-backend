import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BidDocument = Bid & Document;

@Schema({ timestamps: true })
export class Bid {
  @Prop({ required: true })
  auctionId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, min: 1 })
  amount: number;
}

export const BidSchema = SchemaFactory.createForClass(Bid);

BidSchema.index({ auctionId: 1, createdAt: -1 });
