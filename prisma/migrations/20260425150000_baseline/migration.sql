-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'DEVELOPER', 'ADMIN');

-- CreateEnum
CREATE TYPE "MusicStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobTargetType" AS ENUM ('MUSIC', 'VIDEO');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('MUSIC_GENERATION', 'MUSIC_STATUS_POLL', 'VIDEO_RENDER');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "MusicAssetType" AS ENUM ('MP3', 'COVER_IMAGE', 'ALIGNED_LYRICS_RAW_JSON', 'ALIGNED_LYRICS_LINES_JSON', 'TITLE_TEXT');

-- CreateEnum
CREATE TYPE "AssetStorageTier" AS ENUM ('HOT', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('NEW', 'READ', 'REPLIED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleId" TEXT,
    "passwordHash" TEXT NOT NULL,
    "freeCredits" INTEGER NOT NULL DEFAULT 0,
    "paidCredits" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT,
    "name" TEXT,
    "profileImage" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "textBody" TEXT,
    "htmlBody" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InboundEmailStatus" NOT NULL DEFAULT 'NEW',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmailAttachment" (
    "id" TEXT NOT NULL,
    "inboundEmailId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Music" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestGroupId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "lyrics" TEXT NOT NULL,
    "stylePrompt" TEXT NOT NULL,
    "isMr" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "providerTaskId" TEXT,
    "mp3Url" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "rawStatus" TEXT,
    "rawPayload" JSONB,
    "rawResponse" JSONB,
    "isBonusTrack" BOOLEAN NOT NULL DEFAULT false,
    "bonusUnlockedAt" TIMESTAMP(3),
    "status" "MusicStatus" NOT NULL DEFAULT 'QUEUED',
    "duration" INTEGER,
    "tags" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Music_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicLike" (
    "id" TEXT NOT NULL,
    "musicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicAsset" (
    "id" TEXT NOT NULL,
    "musicId" TEXT NOT NULL,
    "assetType" "MusicAssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "storageTier" "AssetStorageTier" NOT NULL DEFAULT 'HOT',
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "storagePath" TEXT,
    "publicUrl" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "checksum" TEXT,
    "archivedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "musicId" TEXT NOT NULL,
    "mp4Url" TEXT,
    "bgImageUrl" TEXT,
    "srtUrl" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "musicId" TEXT,
    "videoId" TEXT,
    "targetType" "JobTargetType" NOT NULL,
    "jobType" "JobType" NOT NULL,
    "queueStatus" "QueueStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "providerTaskId" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");

-- CreateIndex
CREATE INDEX "InboundEmail_status_receivedAt_idx" ON "InboundEmail"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmail_receivedAt_idx" ON "InboundEmail"("receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmailAttachment_inboundEmailId_createdAt_idx" ON "InboundEmailAttachment"("inboundEmailId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Music_providerTaskId_key" ON "Music"("providerTaskId");

-- CreateIndex
CREATE INDEX "Music_userId_createdAt_idx" ON "Music"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Music_requestGroupId_createdAt_idx" ON "Music"("requestGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "Music_status_idx" ON "Music"("status");

-- CreateIndex
CREATE INDEX "Music_isPublic_createdAt_idx" ON "Music"("isPublic", "createdAt");

-- CreateIndex
CREATE INDEX "MusicLike_musicId_createdAt_idx" ON "MusicLike"("musicId", "createdAt");

-- CreateIndex
CREATE INDEX "MusicLike_userId_createdAt_idx" ON "MusicLike"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MusicLike_createdAt_idx" ON "MusicLike"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MusicLike_musicId_userId_key" ON "MusicLike"("musicId", "userId");

-- CreateIndex
CREATE INDEX "MusicAsset_musicId_status_idx" ON "MusicAsset"("musicId", "status");

-- CreateIndex
CREATE INDEX "MusicAsset_assetType_status_idx" ON "MusicAsset"("assetType", "status");

-- CreateIndex
CREATE INDEX "MusicAsset_storageTier_updatedAt_idx" ON "MusicAsset"("storageTier", "updatedAt");

-- CreateIndex
CREATE INDEX "MusicAsset_storageKey_idx" ON "MusicAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MusicAsset_musicId_assetType_key" ON "MusicAsset"("musicId", "assetType");

-- CreateIndex
CREATE INDEX "Video_musicId_createdAt_idx" ON "Video"("musicId", "createdAt");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_createdAt_idx" ON "GenerationJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_queueStatus_jobType_idx" ON "GenerationJob"("queueStatus", "jobType");

-- CreateIndex
CREATE INDEX "GenerationJob_queueStatus_runAfter_priority_idx" ON "GenerationJob"("queueStatus", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "GenerationJob_musicId_idx" ON "GenerationJob"("musicId");

-- CreateIndex
CREATE INDEX "GenerationJob_videoId_idx" ON "GenerationJob"("videoId");

-- CreateIndex
CREATE INDEX "GenerationJob_providerTaskId_idx" ON "GenerationJob"("providerTaskId");

-- AddForeignKey
ALTER TABLE "InboundEmailAttachment" ADD CONSTRAINT "InboundEmailAttachment_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Music" ADD CONSTRAINT "Music_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicLike" ADD CONSTRAINT "MusicLike_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicLike" ADD CONSTRAINT "MusicLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicAsset" ADD CONSTRAINT "MusicAsset_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

