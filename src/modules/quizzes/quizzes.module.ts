import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizAttemptsController } from './quiz-attempts.controller';
import { QuizAttemptsService } from './quiz-attempts.service';
import { QuizSessionsController } from './quiz-sessions.controller';
import { QuizSessionsService } from './quiz-sessions.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QuizzesController, QuizAttemptsController, QuizSessionsController],
  providers: [QuizzesService, QuizAttemptsService, QuizSessionsService],
  exports: [QuizzesService, QuizAttemptsService, QuizSessionsService],
})
export class QuizzesModule {}


