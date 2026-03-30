-- Add isGuest field to User model for anonymous guest login support
ALTER TABLE "User" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
