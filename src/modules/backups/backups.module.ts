import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { EnrollmentsModule } from "../enrollments/enrollments.module";
import { EnrollmentRestoreController } from "./enrollment-restore.controller";
import { EnrollmentRestoreService } from "./enrollment-restore.service";
import { RestoreController } from "./restore.controller";
import { RestoreService } from "./restore.service";
import { DB_BACKUP_S3_CLIENT } from "./backups.constants";
import { DbBackupService } from "./db-backup.service";
import { DbBackupVerificationController } from "./db-backup-verification.controller";
import { DbBackupVerificationService } from "./db-backup-verification.service";

import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";

export function createBackupS3Client(config: ConfigService): S3Client {
  const endpoint = config.get<string>("BACKUP_S3_ENDPOINT");

  return new S3Client({
    region: config.get<string>("AWS_REGION", "us-east-1"),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

@Module({
  imports: [ConfigModule, EnrollmentsModule],
  controllers: [
    EnrollmentRestoreController,
    RestoreController,
    BackupsController,
    DbBackupVerificationController,
  ],
  providers: [
    EnrollmentRestoreService,
    RestoreService,
    BackupsService,
    {
      provide: DB_BACKUP_S3_CLIENT,
      inject: [ConfigService],
      useFactory: createBackupS3Client,
    },
    DbBackupService,
    DbBackupVerificationService,
  ],
  exports: [
    EnrollmentRestoreService,
    RestoreService,
    DbBackupService,
    DbBackupVerificationService,
    BackupsService,
  ],
})
export class BackupsModule {}
