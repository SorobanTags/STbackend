import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { KycService } from './kyc.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';

describe('KycService', () => {
  let service: KycService;

  const mockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    kycSubmission: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockUploads = {
    saveKycDocument: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: UploadsService, useValue: mockUploads },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // submit()
  // ---------------------------------------------------------------------------

  describe('submit()', () => {
    const instructorId = 'instructor-1';
    const dto = { documentType: 'PASSPORT' } as any;
    const docFile = { originalname: 'passport.pdf' } as Express.Multer.File;

    it('throws BadRequestException when an APPROVED submission already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        id: 'sub-existing',
        status: KycStatus.APPROVED,
      });

      await expect(service.submit(instructorId, dto, docFile)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.submit(instructorId, dto, docFile)).rejects.toThrow(
        'Your KYC is already approved',
      );

      // uploads.saveKycDocument must NOT be called — rejected before it reaches that point
      expect(mockUploads.saveKycDocument).not.toHaveBeenCalled();
    });

    it('persists originUrl from uploads.saveKycDocument and returns cdnUrl', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null); // no approved submission

      const primary = { originUrl: 'gs://bucket/kyc/passport.pdf', cdnUrl: 'https://cdn.example.com/kyc/passport.pdf' };
      mockUploads.saveKycDocument.mockResolvedValue(primary);

      const created = {
        id: 'sub-1',
        instructorId,
        documentType: 'PASSPORT',
        documentUrl: primary.originUrl,
        additionalUrl: null,
        status: KycStatus.PENDING,
      };
      mockPrisma.kycSubmission.create.mockResolvedValue(created);

      const result = await service.submit(instructorId, dto, docFile);

      // originUrl was persisted in the DB record
      expect(mockPrisma.kycSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ documentUrl: primary.originUrl }),
        }),
      );

      // cdnUrl is exposed in the returned object
      expect(result.documentUrl).toBe(primary.cdnUrl);
    });

    it('stores additionalUrl when an additionalFile is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: instructorId });
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);

      const primary = { originUrl: 'gs://bucket/kyc/doc.pdf', cdnUrl: 'https://cdn.example.com/kyc/doc.pdf' };
      const extra = { originUrl: 'gs://bucket/kyc/selfie.png', cdnUrl: 'https://cdn.example.com/kyc/selfie.png' };

      // First call → primary, second call → additional
      mockUploads.saveKycDocument
        .mockResolvedValueOnce(primary)
        .mockResolvedValueOnce(extra);

      const additionalFile = { originalname: 'selfie.png' } as Express.Multer.File;

      const created = {
        id: 'sub-2',
        instructorId,
        documentType: 'PASSPORT',
        documentUrl: primary.originUrl,
        additionalUrl: extra.originUrl,
        status: KycStatus.PENDING,
      };
      mockPrisma.kycSubmission.create.mockResolvedValue(created);

      const result = await service.submit(instructorId, dto, docFile, additionalFile);

      expect(mockUploads.saveKycDocument).toHaveBeenCalledTimes(2);

      // additionalUrl was persisted as originUrl
      expect(mockPrisma.kycSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ additionalUrl: extra.originUrl }),
        }),
      );

      // cdnUrl exposed in the response
      expect(result.additionalUrl).toBe(extra.cdnUrl);
    });

    it('throws NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.submit(instructorId, dto, docFile)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getVerificationStatus()
  // ---------------------------------------------------------------------------

  describe('getVerificationStatus()', () => {
    const instructorId = 'instructor-1';

    it('returns isVerified=true only when the latest submission is APPROVED', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        status: KycStatus.APPROVED,
        adminNotes: 'Looks good',
        reviewedAt: new Date('2026-01-01'),
      });

      const result = await service.getVerificationStatus(instructorId);

      expect(result.isVerified).toBe(true);
      expect(result.status).toBe(KycStatus.APPROVED);
      expect(result.adminNotes).toBe('Looks good');
    });

    it('returns isVerified=false when the latest submission is PENDING', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        status: KycStatus.PENDING,
        adminNotes: null,
        reviewedAt: null,
      });

      const result = await service.getVerificationStatus(instructorId);

      expect(result.isVerified).toBe(false);
      expect(result.status).toBe(KycStatus.PENDING);
    });

    it('returns null status and isVerified=false when no submission exists', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);

      const result = await service.getVerificationStatus(instructorId);

      expect(result.isVerified).toBe(false);
      expect(result.status).toBeNull();
      expect(result.adminNotes).toBeNull();
      expect(result.reviewedAt).toBeNull();
    });

    it('returns isVerified=false when the latest submission is REJECTED', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        status: KycStatus.REJECTED,
        adminNotes: 'Document unclear',
        reviewedAt: new Date('2026-01-02'),
      });

      const result = await service.getVerificationStatus(instructorId);

      expect(result.isVerified).toBe(false);
      expect(result.status).toBe(KycStatus.REJECTED);
    });
  });
});
