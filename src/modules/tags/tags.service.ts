import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { MergeTagsDto } from './dto/merge-tags.dto';
import { AttachTagDto } from './dto/attach-tag.dto';
import { QueryTagsDto } from './dto/query-tags.dto';

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  /**
   * Converts a human-readable label into a normalised, URL-safe slug used as
   * the unique `name` field.
   *
   * "Web Design"  →  "web-design"
   * "UI/UX & Branding" → "ui-ux-branding"
   */
  private normalise(label: string): string {
    return label
      .trim()
      .toLowerCase()
      // replace ampersands and slashes with a hyphen
      .replace(/[&/\\]+/g, '-')
      // replace any run of whitespace or non-alphanumeric chars with a hyphen
      .replace(/[\s\W]+/g, '-')
      // collapse multiple consecutive hyphens
      .replace(/-{2,}/g, '-')
      // strip leading / trailing hyphens
      .replace(/^-+|-+$/g, '');
  }

  /** Throws NotFoundException if the tag does not exist. */
  private async findTagOrThrow(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException(`Tag ${id} not found`);
    return tag;
  }

  // ----------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------

  /**
   * Admin creates a new searchable tag.
   * The `name` (slug) is derived automatically from the `label`.
   * Duplicate detection is case-insensitive via the normalised slug.
   */
  async create(adminId: string, dto: CreateTagDto) {
    const name = this.normalise(dto.label);
    if (!name) {
      throw new BadRequestException(
        'Tag label must contain at least one alphanumeric character',
      );
    }

    const existing = await this.prisma.tag.findUnique({ where: { name } });
    if (existing) {
      throw new ConflictException(
        `A tag with label "${existing.label}" already exists (slug: "${name}")`,
      );
    }

    const tag = await this.prisma.tag.create({
      data: { name, label: dto.label.trim() },
    });

    await this.auditLog.createEntry(adminId, {
      action: AuditAction.TAG_CREATED,
      targetType: AuditTargetType.TAG,
      targetId: tag.id,
      metadata: { name: tag.name, label: tag.label },
    });

    this.logger.log(`Tag created: "${tag.label}" (${tag.id}) by admin ${adminId}`);
    return tag;
  }

  // ----------------------------------------------------------
  // READ — list sorted by popularity
  // ----------------------------------------------------------

  /**
   * Returns a paginated list of tags, sorted by usageCount descending
   * (most popular first).  Supports an optional label search filter.
   */
  async findAll(query: QueryTagsDto) {
    const page  = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip  = (page - 1) * limit;

    const where: Prisma.TagWhereInput = {};
    if (query.search) {
      where.label = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.tag.findMany({
        where,
        orderBy: [
          { usageCount: 'desc' },
          { label: 'asc' },       // stable secondary sort
        ],
        skip,
        take: limit,
        include: {
          _count: { select: { courses: true } },
        },
      }),
      this.prisma.tag.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ----------------------------------------------------------
  // READ — single tag
  // ----------------------------------------------------------

  async findOne(id: string) {
    const tag = await this.prisma.tag.findUnique({
      where: { id },
      include: {
        _count: { select: { courses: true } },
        courses: {
          include: {
            course: {
              select: { id: true, title: true, status: true, thumbnailUrl: true },
            },
          },
        },
      },
    });
    if (!tag) throw new NotFoundException(`Tag ${id} not found`);
    return tag;
  }

  // ----------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------

  /**
   * Admin updates a tag's display label.
   * The normalised slug is regenerated from the new label.
   */
  async update(id: string, adminId: string, dto: UpdateTagDto) {
    const tag = await this.findTagOrThrow(id);

    if (!dto.label) return tag; // nothing to change

    const newName = this.normalise(dto.label);
    if (!newName) {
      throw new BadRequestException(
        'Tag label must contain at least one alphanumeric character',
      );
    }

    // Check for a slug collision with a *different* tag
    if (newName !== tag.name) {
      const conflict = await this.prisma.tag.findUnique({ where: { name: newName } });
      if (conflict) {
        throw new ConflictException(
          `A tag with label "${conflict.label}" already exists (slug: "${newName}")`,
        );
      }
    }

    const updated = await this.prisma.tag.update({
      where: { id },
      data: { name: newName, label: dto.label.trim() },
    });

    await this.auditLog.createEntry(adminId, {
      action: AuditAction.TAG_UPDATED,
      targetType: AuditTargetType.TAG,
      targetId: id,
      metadata: {
        oldName: tag.name,
        oldLabel: tag.label,
        newName: updated.name,
        newLabel: updated.label,
      },
    });

    this.logger.log(`Tag updated: ${id} → "${updated.label}" by admin ${adminId}`);
    return updated;
  }

  // ----------------------------------------------------------
  // DELETE
  // ----------------------------------------------------------

  /**
   * Admin deletes a tag.
   * All CourseTag join records are removed via the CASCADE constraint defined
   * in the migration, and each affected course's usageCount is already
   * represented by the DB cascade — no manual decrement needed.
   */
  async remove(id: string, adminId: string) {
    const tag = await this.findTagOrThrow(id);

    await this.prisma.tag.delete({ where: { id } });

    await this.auditLog.createEntry(adminId, {
      action: AuditAction.TAG_DELETED,
      targetType: AuditTargetType.TAG,
      targetId: id,
      metadata: { name: tag.name, label: tag.label, usageCount: tag.usageCount },
    });

    this.logger.log(`Tag deleted: "${tag.label}" (${id}) by admin ${adminId}`);
    return { message: `Tag "${tag.label}" deleted successfully` };
  }

  // ----------------------------------------------------------
  // MERGE DUPLICATE TAGS
  // ----------------------------------------------------------

  /**
   * Merges one or more source tags into a single target tag.
   *
   * Steps:
   *  1. Verify the target and all source tags exist.
   *  2. For every source tag, move its CourseTag associations to the target
   *     (skipping any course already associated with the target to avoid
   *     unique-constraint violations).
   *  3. Delete the now-empty source tags.
   *  4. Recalculate the target's usageCount from the live join-table count.
   */
  async merge(targetTagId: string, adminId: string, dto: MergeTagsDto) {
    const { sourceTagIds } = dto;

    if (sourceTagIds.includes(targetTagId)) {
      throw new BadRequestException('Target tag ID must not appear in sourceTagIds');
    }

    // 1. Verify all tags exist
    const targetTag = await this.findTagOrThrow(targetTagId);
    await Promise.all(sourceTagIds.map((id) => this.findTagOrThrow(id)));

    // 2. Move associations from each source tag to the target tag
    for (const sourceId of sourceTagIds) {
      const sourceCourses = await this.prisma.courseTag.findMany({
        where: { tagId: sourceId },
        select: { courseId: true },
      });

      const targetCourses = await this.prisma.courseTag.findMany({
        where: { tagId: targetTagId },
        select: { courseId: true },
      });
      const targetCourseIds = new Set(targetCourses.map((c) => c.courseId));

      for (const { courseId } of sourceCourses) {
        if (targetCourseIds.has(courseId)) {
          // Course already linked to target — just drop the source link
          await this.prisma.courseTag.delete({
            where: { courseId_tagId: { courseId, tagId: sourceId } },
          });
        } else {
          await this.prisma.courseTag.update({
            where: { courseId_tagId: { courseId, tagId: sourceId } },
            data: { tagId: targetTagId },
          });
        }
      }
    }

    // 3. Delete the now-empty source tags
    await this.prisma.tag.deleteMany({ where: { id: { in: sourceTagIds } } });

    // 4. Recalculate target usageCount from the live join-table count
    const usageCount = await this.prisma.courseTag.count({
      where: { tagId: targetTagId },
    });
    const updated = await this.prisma.tag.update({
      where: { id: targetTagId },
      data: { usageCount },
    });

    await this.auditLog.createEntry(adminId, {
      action: AuditAction.TAG_MERGED,
      targetType: AuditTargetType.TAG,
      targetId: targetTagId,
      metadata: {
        targetLabel: targetTag.label,
        sourceTagIds,
        newUsageCount: usageCount,
      },
    });

    this.logger.log(
      `Tags merged into "${updated.label}" (${targetTagId}): [${sourceTagIds.join(', ')}] by admin ${adminId}`,
    );
    return updated;
  }

  // ----------------------------------------------------------
  // ATTACH / DETACH
  // ----------------------------------------------------------

  /**
   * Attaches a tag to a course.  Idempotent: re-attaching an existing link
   * is a no-op.  Recalculates the tag's usageCount afterwards.
   */
  async attachToCourse(tagId: string, adminId: string, dto: AttachTagDto) {
    const tag = await this.findTagOrThrow(tagId);

    const existing = await this.prisma.courseTag.findUnique({
      where: { courseId_tagId: { courseId: dto.courseId, tagId } },
    });

    if (!existing) {
      await this.prisma.courseTag.create({
        data: { courseId: dto.courseId, tagId },
      });

      const usageCount = await this.prisma.courseTag.count({ where: { tagId } });
      await this.prisma.tag.update({ where: { id: tagId }, data: { usageCount } });

      await this.auditLog.createEntry(adminId, {
        action: AuditAction.TAG_ATTACHED,
        targetType: AuditTargetType.TAG,
        targetId: tagId,
        metadata: { courseId: dto.courseId, label: tag.label },
      });

      this.logger.log(`Tag "${tag.label}" attached to course ${dto.courseId} by admin ${adminId}`);
    }

    return this.findOne(tagId);
  }

  /**
   * Detaches a tag from a course.  Idempotent: detaching a non-existent link
   * is a no-op.  Recalculates the tag's usageCount afterwards.
   */
  async detachFromCourse(tagId: string, adminId: string, dto: AttachTagDto) {
    const tag = await this.findTagOrThrow(tagId);

    const existing = await this.prisma.courseTag.findUnique({
      where: { courseId_tagId: { courseId: dto.courseId, tagId } },
    });

    if (existing) {
      await this.prisma.courseTag.delete({
        where: { courseId_tagId: { courseId: dto.courseId, tagId } },
      });

      const usageCount = await this.prisma.courseTag.count({ where: { tagId } });
      await this.prisma.tag.update({ where: { id: tagId }, data: { usageCount } });

      await this.auditLog.createEntry(adminId, {
        action: AuditAction.TAG_DETACHED,
        targetType: AuditTargetType.TAG,
        targetId: tagId,
        metadata: { courseId: dto.courseId, label: tag.label },
      });

      this.logger.log(`Tag "${tag.label}" detached from course ${dto.courseId} by admin ${adminId}`);
    }

    return this.findOne(tagId);
  }
}
