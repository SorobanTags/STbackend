import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BundlesService } from './bundles.service';

const mockBundle = {
  id: 'bundle-1',
  isActive: true,
  price: 50,
  instructorAddress: 'GINSTRUCTOR',
  title: 'Test Bundle',
  description: 'desc',
  thumbnailUrl: null,
  courses: [
    { course: { id: 'course-1', price: 30, instructorAddress: 'GINSTRUCTOR', title: 'C1' } },
    { course: { id: 'course-2', price: 40, instructorAddress: 'GINSTRUCTOR', title: 'C2' } },
  ],
  _count: { enrollments: 0 },
  instructor: { name: 'Alice', avatarUrl: null, stellarAddress: 'GINSTRUCTOR' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BundlesService', () => {
  let service: BundlesService;

  const mockPrisma = {
    course: { findMany: jest.fn(), findUnique: jest.fn() },
    bundle: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
    bundleEnrollment: { findUnique: jest.fn(), create: jest.fn() },
    enrollment: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BundlesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BundlesService>(BundlesService);
    jest.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // create() — issue #54: USDC validation
  // ----------------------------------------------------------------

  describe('create()', () => {
    const baseDto = {
      title: 'Bundle',
      description: 'desc',
      price: 50,
      thumbnailUrl: null,
      courseIds: ['course-1', 'course-2'],
    };

    it('throws BadRequestException for a negative price', async () => {
      await expect(
        service.create('user-1', 'GINSTRUCTOR', { ...baseDto, price: -1 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.course.findMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for a price with more than 7 decimal places', async () => {
      await expect(
        service.create('user-1', 'GINSTRUCTOR', { ...baseDto, price: 1.000000001 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a non-finite price (Infinity)', async () => {
      await expect(
        service.create('user-1', 'GINSTRUCTOR', { ...baseDto, price: Infinity }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for zero price', async () => {
      await expect(
        service.create('user-1', 'GINSTRUCTOR', { ...baseDto, price: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a bundle for a valid price below individualTotal', async () => {
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'course-1', price: 30, instructorAddress: 'GINSTRUCTOR' },
        { id: 'course-2', price: 40, instructorAddress: 'GINSTRUCTOR' },
      ]);
      mockPrisma.bundle.create.mockResolvedValue(mockBundle);

      const result = await service.create('user-1', 'GINSTRUCTOR', baseDto);
      expect(result).toBeDefined();
      expect(mockPrisma.bundle.create).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // enroll() — issue #53
  // ----------------------------------------------------------------

  describe('enroll()', () => {
    const enrollDto = { amountPaid: 50, txHash: 'txhash-1' };

    beforeEach(() => {
      mockPrisma.bundle.findUnique.mockResolvedValue(mockBundle);
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue(null);
    });

    it('throws BadRequestException for an inactive bundle', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue({ ...mockBundle, isActive: false });
      await expect(service.enroll('student-1', 'bundle-1', enrollDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException on pre-check for existing enrollment without touching $transaction', async () => {
      mockPrisma.bundleEnrollment.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.enroll('student-1', 'bundle-1', enrollDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('translates a P2002 from bundleEnrollment.create into ConflictException', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5',
      });

      mockPrisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          bundleEnrollment: { create: jest.fn().mockRejectedValue(p2002) },
          enrollment: { createMany: jest.fn() },
          course: { update: jest.fn() },
        };
        return cb(tx);
      });

      await expect(service.enroll('student-1', 'bundle-1', enrollDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not increment course stats when count === 0 (ON CONFLICT skipped row)', async () => {
      const courseUpdate = jest.fn();
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          bundleEnrollment: { create: jest.fn().mockResolvedValue({ id: 'be-1' }) },
          enrollment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
          course: { update: courseUpdate },
        };
        return cb(tx);
      });

      await service.enroll('student-1', 'bundle-1', enrollDto);
      expect(courseUpdate).not.toHaveBeenCalled();
    });

    it('increments course stats only for newly created enrollments', async () => {
      const courseUpdate = jest.fn().mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          bundleEnrollment: { create: jest.fn().mockResolvedValue({ id: 'be-1' }) },
          enrollment: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
          course: { update: courseUpdate },
        };
        return cb(tx);
      });

      await service.enroll('student-1', 'bundle-1', enrollDto);
      expect(courseUpdate).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when bundle does not exist', async () => {
      mockPrisma.bundle.findUnique.mockResolvedValue(null);
      await expect(service.enroll('student-1', 'bundle-missing', enrollDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
