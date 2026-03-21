import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuctionDocument = Auction & Document;

@Schema({ timestamps: true })
export class Auction {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop([String])
  images: string[];

  @Prop({ required: true })
  startingPrice: number;

  @Prop({ required: true })
  currentPrice: number;

  @Prop({ enum: ['ACTIVE', 'ENDED'], default: 'ACTIVE' })
  status: string;

  @Prop({ required: true })
  startTime: Date;

  @Prop({ required: true })
  endTime: Date;

  @Prop()
  category: string;

  @Prop({ required: true })
  createdBy: string;

  @Prop()
  highestBidder: string;

  @Prop()
  winner?: string;

  @Prop({ default: false })
  notified: boolean;

  @Prop({ enum: ['PAID', 'ACTIVE'], default: 'ACTIVE' })
  paymentStatus: string;
}

export const AuctionSchema = SchemaFactory.createForClass(Auction);

AuctionSchema.index({ status: 1 });
AuctionSchema.index({ endTime: 1 });
AuctionSchema.index({ category: 1 });
