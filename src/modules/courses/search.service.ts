import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, CourseStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CourseSearchSuggestion {
  text: string;
  type: 'course' | 'category' | 'popular';
  courseId?: string;
  popularity: number;
  rank: number;
}

@Injectable()
export class SearchService {
  private readonly minQueryLength = 2;
  private readonly defaultLimit = 10;
  private readonly maxLimit = 25;
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  async autocomplete(query: string, requestedLimit?: number) {
    const normalizedQuery = this.normalizeQuery(query);
    if (normalizedQuery.length < this.minQueryLength) {
      throw new BadRequestException(`Search query must be at least ${this.minQueryLength} characters long`);
    }

    const limit = this.normalizeLimit(requestedLimit);
    await this.trackSearchTerm(normalizedQuery);

    const [courses, popularTerms] = await Promise.all([
      this.prisma.course.findMany({
        where: {
          status: CourseStatus.ACTIVE,
          OR: [
            { title: { contains: normalizedQuery, mode: 'insensitive' } },
            { category: { contains: normalizedQuery, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          category: true,
          totalEnrollments: true,
          avgRating: true,
        },
        orderBy: [
          { totalEnrollments: 'desc' },
          { avgRating: 'desc' },
          { id: 'asc' },
        ],
        take: limit * 2,
      }),
      (this.prisma as any).courseSearchTerm.findMany({
        where: { term: { contains: normalizedQuery, mode: 'insensitive' } },
        orderBy: [{ searchCount: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      }),
    ]);

    const suggestions = new Map<string, CourseSearchSuggestion>();

    for (const term of popularTerms) {
      this.addSuggestion(suggestions, {
        text: term.term,
        type: 'popular',
        popularity: term.searchCount,
        rank: this.rankText(term.term, normalizedQuery, 40) + term.searchCount,
      });
    }

    for (const course of courses) {
      this.addSuggestion(suggestions, {
        text: course.title,
        type: 'course',
        courseId: course.id,
        popularity: course.totalEnrollments,
        rank: this.rankText(course.title, normalizedQuery, 100)
          + course.totalEnrollments
          + Math.round(course.avgRating * 10),
      });

      this.addSuggestion(suggestions, {
        text: course.category,
        type: 'category',
        popularity: course.totalEnrollments,
        rank: this.rankText(course.category, normalizedQuery, 70) + course.totalEnrollments,
      });
    }

    const data = [...suggestions.values()]
      .sort((a, b) => b.rank - a.rank || b.popularity - a.popularity || a.text.localeCompare(b.text))
      .slice(0, limit);

    return {
      data,
      meta: {
        query: normalizedQuery,
        limit,
        minQueryLength: this.minQueryLength,
        total: data.length,
      },
    };
  }

  private async trackSearchTerm(term: string) {
    try {
      await (this.prisma as any).courseSearchTerm.upsert({
        where: { term },
        create: { term, searchCount: 1 },
        update: { searchCount: { increment: 1 }, lastSearchedAt: new Date() },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`trackSearchTerm P2002 race for term "${term}", falling back to update`);
        await (this.prisma as any).courseSearchTerm.update({
          where: { term },
          data: { searchCount: { increment: 1 }, lastSearchedAt: new Date() },
        });
      } else {
        throw err;
      }
    }
  }

  private addSuggestion(suggestions: Map<string, CourseSearchSuggestion>, suggestion: CourseSearchSuggestion) {
    const key = `${suggestion.type}:${suggestion.text.toLowerCase()}`;
    const existing = suggestions.get(key);
    if (!existing) {
      suggestions.set(key, suggestion);
    } else if (suggestion.rank > existing.rank) {
      // Keep the existing entry's text to preserve stable, human-readable casing (#38)
      suggestions.set(key, { ...suggestion, text: existing.text });
    }
  }

  private normalizeQuery(query?: string) {
    return (query ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private normalizeLimit(limit?: number) {
    const numericLimit = Number(limit) || this.defaultLimit;
    return Math.min(Math.max(Math.floor(numericLimit), 1), this.maxLimit);
  }

  private rankText(text: string, query: string, baseScore: number) {
    const normalizedText = text.toLowerCase();
    if (normalizedText === query) return baseScore + 100;
    if (normalizedText.startsWith(query)) return baseScore + 50;
    // Word-boundary match: query appears at the start of any word in the text (#37)
    const words = normalizedText.split(/[^a-z0-9]+/);
    if (words.some(word => word.startsWith(query))) return baseScore + 25;
    return baseScore;
  }
}
