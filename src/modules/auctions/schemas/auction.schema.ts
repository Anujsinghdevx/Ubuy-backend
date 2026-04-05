import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuctionDocument = Auction & Document;

export const AUCTION_STATUS = ['ACTIVE', 'ENDED', 'CANCELLED'] as const;
export type AuctionStatus = (typeof AUCTION_STATUS)[number];

export const PAYMENT_STATUS = ['PAID', 'ACTIVE'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

type WinnerHistoryEntry = {
  userId: string;
  amount: number;
  reason: string;
  changedAt: Date;
};

@Schema({ timestamps: true })
export class Auction {
  @Prop({ required: true })
  title!: string;

  @Prop()
  description!: string;

  @Prop([String])
  images!: string[];

  @Prop({ required: true })
  startingPrice!: number;

  @Prop({ required: true })
  currentPrice!: number;

  @Prop({ enum: AUCTION_STATUS, default: 'ACTIVE' })
  status!: AuctionStatus;

  @Prop({ required: true })
  startTime!: Date;

  @Prop({ required: true })
  endTime!: Date;

  @Prop()
  category!: string;

  @Prop({ required: true })
  createdBy!: string;

  @Prop()
  highestBidder?: string;

  @Prop()
  winner?: string;

  @Prop({ default: false })
  notified!: boolean;

  @Prop({ enum: PAYMENT_STATUS, default: 'ACTIVE' })
  paymentStatus!: PaymentStatus;

  @Prop()
  paymentDueAt?: Date;

  @Prop({
    type: [
      {
        userId: { type: String, required: true },
        amount: { type: Number, required: true },
        reason: { type: String, required: true },
        changedAt: { type: Date, required: true },
      },
    ],
    default: [],
  })
  winnerHistory!: WinnerHistoryEntry[];
}

export const AuctionSchema = SchemaFactory.createForClass(Auction);

AuctionSchema.index({ status: 1 });
AuctionSchema.index({ endTime: 1 });
AuctionSchema.index({ category: 1 });
AuctionSchema.index({ winner: 1, paymentStatus: 1 });
AuctionSchema.index({ paymentDueAt: 1 });
AuctionSchema.index({ status: 1, paymentStatus: 1, paymentDueAt: 1 });
