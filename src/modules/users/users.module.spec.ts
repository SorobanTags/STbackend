import { Test } from '@nestjs/testing';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrismaService = {
  user: {},
  course: {},
  adminAuditLog: {},
};

describe('UsersModule', () => {
  it('compiles and resolves UsersService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    const usersService = moduleRef.get(UsersService);
    expect(usersService).toBeInstanceOf(UsersService);
  });
});
