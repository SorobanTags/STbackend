import { ConfigService } from "@nestjs/config";
import { S3Client } from "@aws-sdk/client-s3";
import { createBackupS3Client } from "./backups.module";

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation((configuration: unknown) => ({
    configuration,
  })),
}));

describe("BackupsModule S3 client configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enables path-style addressing for a configured S3-compatible endpoint", () => {
    const config = new ConfigService({
      BACKUP_S3_ENDPOINT: "http://localhost:9000",
      AWS_REGION: "eu-west-1",
    });

    createBackupS3Client(config);

    expect(S3Client).toHaveBeenCalledWith({
      region: "eu-west-1",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });
  });

  it("omits endpoint options and defaults the region when no endpoint is configured", () => {
    const config = new ConfigService({});

    createBackupS3Client(config);

    expect(S3Client).toHaveBeenCalledWith({ region: "us-east-1" });
  });
});
