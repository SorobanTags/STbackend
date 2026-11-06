import { IsString, IsOptional, IsInt, IsArray, Min, Max } from 'class-validator';

export class QuestionDto {
  @IsString()
  id: string;

  @IsString()
  question: string;

  @IsArray()
  options: string[];

  @IsArray()
  correctAnswer: (number | string)[];

  @IsInt()
  @Min(1)
  points: number;
}

export class CreateExamDto {
  @IsString()
  courseId: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passingScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cooldownHours?: number;

  @IsArray()
  questions: QuestionDto[];
}
