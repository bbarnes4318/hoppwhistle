import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

import yaml from 'js-yaml';
import openapiTS, { COMMENT_HEADER } from 'openapi-typescript';
import * as ts from 'typescript';

async function generateTypes() {
  const openApiSpecPath = join(process.cwd(), '../../docs/openapi.yaml');
  const outputPath = join(process.cwd(), 'src/generated-types.ts');

  console.log('Generating TypeScript types from OpenAPI spec...');
  console.log(`Input: ${openApiSpecPath}`);
  console.log(`Output: ${outputPath}`);

  try {
    // Load and modify the YAML to ensure compatibility
    const yamlContent = readFileSync(openApiSpecPath, 'utf-8');
    const spec = yaml.load(yamlContent) as any;
    
    // Ensure openapi version is exactly 3.0.0 (redoc/validation expects this format)
    if (spec.openapi) {
      const version = spec.openapi.toString();
      if (version.startsWith('3.')) {
        spec.openapi = '3.0.0';
      }
    }
    
    // Convert to JSON and write to temp file (openapi-typescript handles JSON better)
    const tempPath = join(process.cwd(), 'temp-openapi.json');
    const jsonContent = JSON.stringify(spec, null, 2);
    writeFileSync(tempPath, jsonContent, 'utf-8');

    // Verify the file was written correctly
    const verifySpec = JSON.parse(readFileSync(tempPath, 'utf-8'));
    if (verifySpec.openapi !== '3.0.0') {
      throw new Error(`Version mismatch: expected 3.0.0, got ${verifySpec.openapi}`);
    }

    console.log('Calling openapi-typescript...');
    console.log(`Using spec version: ${verifySpec.openapi}`);
    
    // Try passing the spec object directly instead of file path
    console.log('Attempting to pass spec object directly...');
    const typeNodes = await openapiTS(spec, {
      export: true,
      cwd: join(process.cwd(), '../../'),
    });

    // Convert TypeScript AST nodes to string
    const printer = ts.createPrinter({
      removeComments: false,
    });
    const sourceFile = ts.createSourceFile(
      'generated-types.ts',
      '',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );
    
    const output = COMMENT_HEADER + typeNodes.map(node => printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)).join('\n\n');
    
    writeFileSync(outputPath, output, 'utf-8');
    
    // Clean up temp file
    try {
      unlinkSync(tempPath);
    } catch {}

    console.log('✅ Types generated successfully!');
  } catch (error: any) {
    console.error('❌ Error generating types:', error);
    if (error.message) {
      console.error('Error message:', error.message);
    }
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

generateTypes();
