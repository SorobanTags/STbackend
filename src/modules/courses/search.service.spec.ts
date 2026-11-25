import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      course: { findMany: jest.fn() },
      courseSearchTerm: { upsert: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SearchService);
  });

  describe('autocomplete()', () => {
    it('returns empty result for empty query without throwing', async () => {
      const result = await service.autocomplete('');
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prisma.courseSearchTerm.upsert).not.toHaveBeenCalled();
    });

    it('returns empty result for one-character query without throwing', async () => {
      const result = await service.autocomplete('a');
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prisma.courseSearchTerm.upsert).not.toHaveBeenCalled();
    });

    it('returns suggestions for query at minimum length', async () => {
      prisma.courseSearchTerm.findMany.mockResolvedValue([]);
      prisma.course.findMany.mockResolvedValue([
        { id: 'course-1', title: 'AB Course', category: 'Science', totalEnrollments: 5, avgRating: 4.0 },
      ]);

      const result = await service.autocomplete('ab');
      expect(result.data.length).toBeGreaterThan(0);
      expect(prisma.courseSearchTerm.upsert).not.toHaveBeenCalled();
    });

    it('does not call courseSearchTerm.upsert for valid queries', async () => {
      prisma.courseSearchTerm.findMany.mockResolvedValue([{ term: 'baking', searchCount: 7 }]);
      prisma.course.findMany.mockResolvedValue([
        { id: 'course-1', title: 'Baking Basics', category: 'Baking', totalEnrollments: 15, avgRating: 4.8 },
        { id: 'course-2', title: 'Advanced Cake Baking', category: 'Culinary', totalEnrollments: 3, avgRating: 4.5 },
      ]);

      const result = await service.autocomplete('  Ba  ', 2);

      expect(prisma.courseSearchTerm.upsert).not.toHaveBeenCalled();
      expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ text: 'Baking Basics', type: 'course', courseId: 'course-1' });
      expect(result.meta).toMatchObject({ query: 'ba', limit: 2, minQueryLength: 2, total: 2 });
    });
  });

  describe('recordSearchTerm()', () => {
    it('calls upsert once with the normalised term', async () => {
      prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);

      await service.recordSearchTerm('  Baking  ');

      expect(prisma.courseSearchTerm.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.courseSearchTerm.upsert).toHaveBeenCalledWith({
        where: { term: 'baking' },
        create: { term: 'baking', searchCount: 1 },
        update: { searchCount: { increment: 1 }, lastSearchedAt: expect.any(Date) },
      });
    });

    it('does not call upsert for terms shorter than minimum length', async () => {
      await service.recordSearchTerm('a');
      expect(prisma.courseSearchTerm.upsert).not.toHaveBeenCalled();
    });
  });

  // Issue #32: course.findMany must include a deterministic orderBy
  it('calls course.findMany with deterministic orderBy (issue #32)', async () => {
    prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);
    prisma.courseSearchTerm.findMany.mockResolvedValue([]);
    prisma.course.findMany.mockResolvedValue([]);

    await service.autocomplete('js');

    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { totalEnrollments: 'desc' },
          { avgRating: 'desc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('returns identically ordered data for repeated calls with the same mocked rows (issue #32)', async () => {
    const mockCourses = [
      { id: 'c1', title: 'Rust Fundamentals', category: 'Systems', totalEnrollments: 100, avgRating: 4.9 },
      { id: 'c2', title: 'Rust Advanced', category: 'Systems', totalEnrollments: 50, avgRating: 4.5 },
    ];

    prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);
    prisma.courseSearchTerm.findMany.mockResolvedValue([]);
    prisma.course.findMany.mockResolvedValue(mockCourses);

    const r1 = await service.autocomplete('rust');
    const r2 = await service.autocomplete('rust');

    expect(r1.data.map(s => s.text)).toEqual(r2.data.map(s => s.text));
  });

  // Issue #31: P2002 from upsert should trigger fallback update, not propagate
  it('falls back to update when upsert throws P2002 (issue #31)', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    prisma.courseSearchTerm.upsert.mockRejectedValue(p2002);
    prisma.courseSearchTerm.update.mockResolvedValue(undefined);
    prisma.courseSearchTerm.findMany.mockResolvedValue([]);
    prisma.course.findMany.mockResolvedValue([]);

    await expect(service.autocomplete('rust')).resolves.toBeDefined();

    expect(prisma.courseSearchTerm.update).toHaveBeenCalledWith({
      where: { term: 'rust' },
      data: { searchCount: { increment: 1 }, lastSearchedAt: expect.any(Date) },
    });
  });

  // Issue #37: rankText word-boundary tier
  it('ranks word-boundary match above mid-word match (issue #37)', async () => {
    prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);
    prisma.courseSearchTerm.findMany.mockResolvedValue([]);
    prisma.course.findMany.mockResolvedValue([
      { id: 'c1', title: 'Advanced Next.js', category: 'Web', totalEnrollments: 10, avgRating: 4.0 },
      { id: 'c2', title: 'Nexus of Skills', category: 'General', totalEnrollments: 10, avgRating: 4.0 },
    ]);

    const result = await service.autocomplete('nex', 10);

    const titles = result.data.filter(s => s.type === 'course').map(s => s.text);
    expect(titles.indexOf('Nexus of Skills')).toBeLessThan(titles.indexOf('Advanced Next.js'));
  });

  // Issue #38: deduplication keeps first-seen casing regardless of rank order
  it('deduplicates categories case-insensitively and returns stable casing (issue #38)', async () => {
    prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);
    prisma.courseSearchTerm.findMany.mockResolvedValue([]);

    const coursesAsc = [
      { id: 'c1', title: 'Web Dev Basics', category: 'Web Development', totalEnrollments: 5, avgRating: 4.0 },
      { id: 'c2', title: 'Web Dev Pro', category: 'web development', totalEnrollments: 100, avgRating: 5.0 },
    ];
    const coursesDesc = [...coursesAsc].reverse();

    prisma.course.findMany.mockResolvedValueOnce(coursesAsc);
    const r1 = await service.autocomplete('web');

    prisma.courseSearchTerm.upsert.mockResolvedValue(undefined);
    prisma.course.findMany.mockResolvedValueOnce(coursesDesc);
    const r2 = await service.autocomplete('web');

    const catSuggestions1 = r1.data.filter(s => s.type === 'category');
    const catSuggestions2 = r2.data.filter(s => s.type === 'category');

    // Exactly one suggestion per lowercased key
    expect(catSuggestions1).toHaveLength(1);
    expect(catSuggestions2).toHaveLength(1);
    // Casing is identical regardless of input order
    expect(catSuggestions1[0].text).toEqual(catSuggestions2[0].text);
  });
});
