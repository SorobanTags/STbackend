import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditAction, AuditTargetType } from '@prisma/client';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: PrismaService;

  const mockPrisma = {
    adminAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockConfig = {
    get: jest.fn().mockImplementation((key, defaultValue) => defaultValue),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createEntry', () => {
    it('should create an audit log entry', async () => {
      const dto = {
        action: AuditAction.COURSE_APPROVED,
        targetType: AuditTargetType.COURSE,
        targetId: 'course-123',
        ipAddress: '127.0.0.1',
      };
      
      const expectedCreate = {
        actorId: 'admin-1',
        action: dto.action,
        targetType: dto.targetType,
        targetId: dto.targetId,
        metadata: null,
        ipAddress: dto.ipAddress,
      };

      mockPrisma.adminAuditLog.create.mockResolvedValue(expectedCreate);

      const result = await service.createEntry('admin-1', dto);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({ data: expectedCreate });
      expect(result).toEqual(expectedCreate);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const mockData = [{ id: 'log-1' }];
      mockPrisma.adminAuditLog.findMany.mockResolvedValue(mockData);
      mockPrisma.adminAuditLog.count.mockResolvedValue(1);

      const query = { page: 1, limit: 10 };
      const result = await service.findAll(query);

      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
        skip: 0,
        take: 10,
      }));
      expect(result.data).toEqual(mockData);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('exportAuditLogCsv', () => {
    const makeRow = (id: string) => ({
      actorId: 'admin-1',
      actor: { name: 'Admin', email: 'admin@example.com' },
      action: AuditAction.COURSE_APPROVED,
      targetType: AuditTargetType.COURSE,
      targetId: id,
      metadata: null,
      ipAddress: '127.0.0.1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    it('should emit a single header and one line per entry across batches', async () => {
      const batchSize = 500;
      const firstBatch = Array.from({ length: batchSize }, (_, i) => makeRow(`course-${i}`));
      const secondBatch = Array.from({ length: 3 }, (_, i) => makeRow(`course-${batchSize + i}`));

      mockPrisma.adminAuditLog.findMany
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch);

      const csv = await service.exportAuditLogCsv({});
      const lines = csv.split('\n');

      const headerLines = lines.filter((line) => line.startsWith('createdAt,'));
      expect(headerLines).toHaveLength(1);
      expect(lines).toHaveLength(1 + batchSize + secondBatch.length);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('purgeOldEntries', () => {
    it('should delete entries older than retention days', async () => {
      mockPrisma.adminAuditLog.deleteMany.mockResolvedValue({ count: 5 });
      
      await service.purgeOldEntries();

      expect(prisma.adminAuditLog.deleteMany).toHaveBeenCalled();
    });
  });
});
