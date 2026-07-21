// 이 컨트롤러의 책임: GET /search — 쿼리·topK 검증 → 서비스 호출 → zod 응답 직렬화
import { Controller, Get, Query, BadRequestException, Inject } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQuerySchema, SearchResponseSchema, type SearchQuery } from './search.dto';

@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Get('search')
  async search(@Query() rawQuery: Record<string, unknown>) {
    const parsed = SearchQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid search parameters',
        errors: parsed.error.flatten(),
      });
    }

    const query: SearchQuery = parsed.data;
    const result = await this.searchService.search(query.q, query.topK);
    return SearchResponseSchema.parse(result);
  }
}
