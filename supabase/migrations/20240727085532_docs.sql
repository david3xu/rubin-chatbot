-- Enable pgvector extension
create extension if not exists vector with schema public;

-- Create tables 
create table "public"."nodes_page" (
  id bigserial primary key,
  parent_page_id bigint references public.nodes_page,
  path text not null unique,
  checksum text,
  meta jsonb,
  type text,
  source text
);
alter table "public"."nodes_page" enable row level security;

create table "public"."nodes_page_section" (
  id bigserial primary key,
  page_id bigint not null references public.nodes_page on delete cascade,
  content text,
  token_count int,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  embedding vector(768),
  slug text,
  heading text
);
alter table "public"."nodes_page_section" enable row level security;

-- Create an index for the full-text search
create index on "public"."nodes_page_section" using gin(fts);

-- Create an index for the semantic vector search
create index on "public"."nodes_page_section" using hnsw (embedding vector_ip_ops);

-- Create hybrid search function
create or replace function hybrid_search(
  query_text text,
  query_embedding vector(768),
  match_count int, 
  full_text_weight float = 1,
  semantic_weight float = 1,
  rrf_k int = 50
)
returns setof nodes_page_section
language plpgsql 
as $$
begin 
  return query 
  with full_text as (
    select 
      id, 
      -- Note: ts_rank_id is not indexable but will only rank matches of the where clause 
      -- which shouldn't be too big 
      row_number() over(order by ts_rank_id(fts, websearch_to_tsquery(query_text)) desc) as rank_ix 
    from 
      nodes_page_section
    where 
      fts @@ websearch_to_tsquery(query_text)
    order by rank_ix
    limit least (match_count, 30) * 2
  ),
  semantic as (
    select 
      id,
      row_number() over(order by embedding <#> query_embedding) as rank_ix
    from 
      nodes_page_section
    order by rank_ix
    limit least(match_count, 30) * 2
  )
  select
    nodes_page_section.*
  from 
    full_text
    full outer join semantic
      on full_text.id = semantic.id 
    join nodes_page_section
      on coalesce(full_text.id, semantic.id) = nodes_page_section.id 
  order by 
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight + 
    coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    desc 
  limit 
    least(match_count, 30);
end;
$$;



-- Create embedding similarity search functions
create or replace function match_page_sections(embedding vector(768), match_threshold float, match_count int, min_content_length int)
returns table (id bigint, page_id bigint, slug text, heading text, content text, similarity float)
language plpgsql
as $$
#variable_conflict use_variable
begin
  return query
  select 
    nodes_page_section.id,
    nodes_page_section.page_id,
    nodes_page_section.slug,
    nodes_page_section.heading,
    nodes_page_section.content,
    (nodes_page_section.embedding <#> embedding) * -1 as similarity
  from nodes_page_section

  -- We only care about sections that have a useful amount of content
  where length(nodes_page_section.content) >= min_content_length

  -- The dot product is negative because of a Postgres limitation, so we negate it
  and (nodes_page_section.embedding <#> embedding) * -1 > match_threshold

  -- OpenAI embeddings are normalized to length 1, so
  -- cosine similarity and dot product will produce the same results.
  -- Using dot product which can be computed slightly faster.
  --
  -- For the different syntaxes, see https://github.com/pgvector/pgvector
  order by nodes_page_section.embedding <#> embedding
  
  limit match_count;
end;
$$;

create or replace function get_page_parents(page_id bigint)
returns table (id bigint, parent_page_id bigint, path text, meta jsonb)
language sql
as $$
  with recursive chain as (
    select *
    from nodes_page 
    where id = page_id

    union all

    select child.*
      from nodes_page as child
      join chain on chain.parent_page_id = child.id 
  )
  select id, parent_page_id, path, meta
  from chain;
$$;
