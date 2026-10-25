import {test, expect} from '@playwright/test';
import readExcelFile from 'read-excel-file/node';

const source=JSON.stringify({
  Orders:[{id:'001',key:'A',status:'ok'},{id:'002',key:'B',status:'hold'},{id:'003',key:'A',status:'ok'}],
  Products:[{key:'A',label:'Alpha'},{key:'B',label:'Beta'}],
});
const expected={
  raw:[
    {sheet:'Orders',data:[['id','key','status'],['001','A','ok'],['002','B','hold'],['003','A','ok']]},
    {sheet:'Products',data:[['key','label'],['A','Alpha'],['B','Beta']]},
  ],
  full:[
    {sheet:'Orders',data:[['status','id'],['ok','001'],['hold','002'],['ok','003']]},
    {sheet:'JOIN_OrderLabels',data:[['label','id'],['Alpha','001'],['Beta','002'],['Alpha','003']]},
  ],
  preview:[
    {sheet:'Orders',data:[['status','id'],['ok','001'],['ok','003']]},
    {sheet:'JOIN_OrderLabels',data:[['label','id'],['Alpha','001'],['Alpha','003']]},
  ],
};

for(const background of [false,true]) {
  test(`${background?'Worker':'Window'} exports the same complete raw/full/preview workbook semantics`,async({page})=>{
    const external=[];
    page.on('request',request=>{if(new URL(request.url()).origin!=='http://127.0.0.1:4173')external.push(request.url());});
    await page.goto('/index.html');
    await page.locator('#autoParseToggle').uncheck();
    await page.locator('#rawInput').fill(source);
    await page.locator('#parseBtn').click();
    await expect(page.locator('.data-card.active')).toHaveAttribute('data-parse-state','ready');
    if(background) {
      await page.locator('#addCardBtn').click();
      await page.locator('.data-card').first().click();
      await expect(page.locator('.data-card.active')).toHaveAttribute('data-parse-state','ready');
    }
    await expect.poll(()=>page.evaluate(()=>OTA.require('table-registry').TableRegistry.isBackground())).toBe(background);
    await page.evaluate(()=>{
      const {Store}=OTA.require('store');
      Store.transition('view:upsert',{view:{view:'OrderLabels',left:'Orders',right:'Products',type:'inner',on:'key=key',select:'left.id,left.status,right.label'}});
      Store.transition('view:setEnabled',{enabledViews:['OrderLabels']});
      for(const [key,value] of Object.entries({
        displayTables:['Orders'],exportOnlyChecked:true,exportCols:'shown',globalFilter:'status=ok',
        rules:{Orders:{focus:['status','Missing','id']},'JOIN:OrderLabels':{focus:['label','id']}},
        tablePages:{Orders:3},collapsedTables:{Orders:true},
      })) Store.transition('ui:set',{key,value});
    });
    await expect(page.locator('#viewsTrigger')).toContainText('OrderLabels');
    await expect(page.locator('#datasetSummary')).toContainText('2 表 · 4 行');
    for(const mode of ['raw','full','preview']) {
      if(mode==='raw') await page.locator('#workspaceTools summary').click();
      const pending=page.waitForEvent('download');
      await page.locator(mode==='raw'?'#exportRawBtn':mode==='full'?'#exportFullBtn':'#exportPrevBtn').click();
      const download=await pending;
      expect(download.suggestedFilename()).toMatch(new RegExp(`_${mode}_\\d{8}_\\d{6}\\.xlsx$`));
      expect(await readExcelFile(await download.path())).toEqual(expected[mode]);
    }
    await expect(page.locator('#rawInput')).toHaveValue(source);
    expect(external).toEqual([]);
    if(background) expect(await page.evaluate(()=>OTA.require('table-registry').TableRegistry.getRaw().every(table=>table.rows.length===0))).toBe(true);
  });
}
