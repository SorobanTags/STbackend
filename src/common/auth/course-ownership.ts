import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type OwnershipUser = { id?: string; stellarAddress?: string | null; role?: string };

const DEFAULT_MESSAGE = 'You are not authorized to manage content for this course';

/**
 * Throws ForbiddenException unless the user is an admin or the course's instructor.
 * Fails closed: a missing user is treated as a non-owner.
 */
export function assertCourseOwnership(
  course: { instructorAddress: string; instructor?: { id: string } | null },
  user: OwnershipUser | undefined,
  message = DEFAULT_MESSAGE,
): void {
  if (user?.role === UserRole.ADMIN) return;

  const isOwner =
    (!!user?.stellarAddress && course.instructorAddress === user.stellarAddress) ||
    (!!user?.id && (course.instructorAddress === user.id || course.instructor?.id === user.id));

  if (!isOwner) {
    throw new ForbiddenException(message);
  }
}

export async function loadCourseForOwnership(
  prisma: PrismaService,
  courseId: string,
  user: OwnershipUser | undefined,
) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { instructor: true },
  });

  if (!course) {
    throw new NotFoundException('Course not found');
  }

  assertCourseOwnership(course, user);
  return course;
}
