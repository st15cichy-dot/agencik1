export const EXECUTION_QUALITY_POLICY = Object.freeze({
  appVersion: "0.17.0", mode: "SHADOW_ONLY", executable: false,
  canSubmitOrders: false, brokerConnected: false, brokerAdapter: "NONE", maxAudit: 1000
});
const round=(v,d=8)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const bps=(v,base)=>Number.isFinite(v)&&Number.isFinite(base)&&base!==0?((v-base)/base)*10000:null;
export function simulateShadowFill({preflight,strategyId=null,market={}}){
  const common={schemaVersion:1,appVersion:"0.17.0",mode:"SHADOW_ONLY",executable:false,canSubmitOrders:false,brokerConnected:false,brokerAdapter:"NONE",intentId:preflight?.intentId||null,marketSymbol:preflight?.marketSymbol||null,strategyId};
  if(!preflight?.acceptedForSimulation) return {...common,status:"REJECTED",rejectReasons:[...(preflight?.rejectReasons||["PREFLIGHT_REJECTED"])]};
  const p=preflight.normalized?.price, q=preflight.normalized?.quantity;
  if(!(p>0&&q>0)) return {...common,status:"REJECTED",rejectReasons:["INVALID_NORMALIZED_ORDER"]};
  const spread=Math.max(0,Number(market.spreadBps)||0), vol=Math.max(0,Number(market.volatilityBps)||0), liq=Math.max(0,Number(market.liquidityBps)||0);
  const slippageBps=round(spread/2+vol*.05+liq,4);
  const fillPrice=round(p*(1+slippageBps/10000));
  const requested=preflight.requested||{};
  const roundingPriceBps=round(bps(p,requested.price),4);
  const intentVsFillBps=round(bps(fillPrice,requested.price),4);
  const fillCost=round(fillPrice*q,8);
  const referenceCost=round(p*q,8);
  return {...common,status:"SIMULATED",rejectReasons:[],fillPrice,quantity:q,fillCost,referenceCost,slippageBps,intentVsFillBps,roundingPriceBps,roundingAttribution:{requestedPrice:requested.price??null,normalizedPrice:p,normalizedQuantity:q,priceDeltaBps:roundingPriceBps},costAttribution:{slippageCost:round(fillCost-referenceCost,8),totalSimulatedCost:fillCost}};
}
export function buildExecutionQualityMetrics(items=[]){
  const out={fills:0,rejections:0,bySymbol:{},byStrategy:{}};
  const add=(bucket,key,x)=>{if(!key)return; const v=bucket[key]||{fills:0,rejections:0,totalSlippageBps:0,totalIntentVsFillBps:0}; if(x.status==="SIMULATED"){v.fills++;v.totalSlippageBps+=x.slippageBps||0;v.totalIntentVsFillBps+=x.intentVsFillBps||0;}else v.rejections++; bucket[key]={...v,avgSlippageBps:v.fills?round(v.totalSlippageBps/v.fills,4):null,avgIntentVsFillBps:v.fills?round(v.totalIntentVsFillBps/v.fills,4):null};};
  for(const x of items){if(x?.status==="SIMULATED")out.fills++;else out.rejections++;add(out.bySymbol,x?.marketSymbol,x);add(out.byStrategy,x?.strategyId,x);} return out;
}
export function mergeExecutionQualityAudit(previous=[],additions=[],max=EXECUTION_QUALITY_POLICY.maxAudit){
  const seen=new Set(), out=[]; for(const x of [...additions,...previous]){const id=x?.auditId||[x?.intentId,x?.status,x?.fillPrice].join(":");if(!id||seen.has(id))continue;seen.add(id);out.push({...x,executable:false,canSubmitOrders:false,brokerAdapter:"NONE"});if(out.length>=max)break;} return out;
}
