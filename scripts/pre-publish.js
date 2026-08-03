#!/usr/bin/env node

// ZenTao MCP Server 发布前检查脚本
// 使用方法: node scripts/pre-publish.js

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

console.log('🔍 ZenTao MCP Server 发布前检查');
console.log('================================');

// 检查 package.json
console.log('📦 检查 package.json...');
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  
  // 必需字段检查
  const requiredFields = ['name', 'version', 'description', 'main', 'bin'];
  for (const field of requiredFields) {
    if (!pkg[field]) {
      throw new Error(`缺少必需字段: ${field}`);
    }
  }
  
  // 检查 bin 字段
  if (!pkg.bin || typeof pkg.bin !== 'object') {
    throw new Error('bin 字段必须是一个对象');
  }
  
  // 检查主文件是否存在
  if (!existsSync(pkg.main)) {
    throw new Error(`主文件不存在: ${pkg.main}`);
  }
  
  console.log('✅ package.json 检查通过');
} catch (error) {
  console.error('❌ package.json 检查失败:', error.message);
  process.exit(1);
}

// 检查主文件
console.log('📄 检查主文件...');
try {
  const mainFile = readFileSync('src/mcp-server.mjs', 'utf8');
  
  // 检查 shebang
  if (!mainFile.startsWith('#!/usr/bin/env node')) {
    throw new Error('主文件缺少 shebang (#!/usr/bin/env node)');
  }
  
  // 检查导入
  if (!mainFile.includes("import { FastMCP")) {
    throw new Error('主文件缺少 FastMCP 导入');
  }
  
  console.log('✅ 主文件检查通过');
} catch (error) {
  console.error('❌ 主文件检查失败:', error.message);
  process.exit(1);
}

// 检查 README.md
console.log('📖 检查 README.md...');
try {
  const readme = readFileSync('README.md', 'utf8');
  
  if (!readme.includes('mcp-zentao-bugs')) {
    throw new Error('README.md 缺少包名信息');
  }
  
  if (!readme.includes('npx')) {
    throw new Error('README.md 缺少 npx 使用说明');
  }
  
  console.log('✅ README.md 检查通过');
} catch (error) {
  console.error('❌ README.md 检查失败:', error.message);
  process.exit(1);
}

// 检查 .gitignore
console.log('📁 检查 .gitignore...');
try {
  if (!existsSync('.gitignore')) {
    throw new Error('.gitignore 文件不存在');
  }
  
  const gitignore = readFileSync('.gitignore', 'utf8');
  
  if (!gitignore.includes('node_modules')) {
    throw new Error('.gitignore 缺少 node_modules');
  }
  
  if (!gitignore.includes('.env')) {
    throw new Error('.gitignore 缺少 .env');
  }
  
  console.log('✅ .gitignore 检查通过');
} catch (error) {
  console.error('❌ .gitignore 检查失败:', error.message);
  process.exit(1);
}

// 检查 npm 包名是否可用
console.log('🔍 检查 npm 包名可用性...');
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  
  // 使用 npm view 检查包是否存在
  try {
    execSync(`npm view ${pkg.name}`, { stdio: 'ignore' });
    console.log(`⚠️  包名 ${pkg.name} 已存在，将更新版本`);
  } catch {
    console.log(`✅ 包名 ${pkg.name} 可用`);
  }
} catch (error) {
  console.error('❌ 包名检查失败:', error.message);
  process.exit(1);
}

console.log('\n🎉 所有检查通过，可以发布！');
console.log('\n📋 发布步骤:');
console.log('1. 确保已登录 npm: npm login');
console.log('2. 运行发布脚本: npm run release:patch (或 minor/major)');
console.log('3. 或使用脚本: ./scripts/publish.sh patch');
console.log('\n💡 提示: 发布前请确保测试通过并更新 README.md');