function measure(channels) {
  let peak=0,sum=0,count=0;
  for(const c of channels)for(let i=0;i<c.length;i++){const x=c[i];if(!Number.isFinite(x))throw Error('invalid');peak=Math.max(peak,Math.abs(x));sum+=x*x;count++;}
  return {peak,rms:Math.sqrt(sum/Math.max(1,count))};
}
function limitPeaks(channels,rate,ceilingDb=-1) {
  // Linked stereo, 5 ms lookahead sample-peak limiter. This is not a true-peak limiter.
  const n=channels[0].length,window=Math.max(1,Math.round(rate*.005)),ceiling=10**(ceilingDb/20);
  const peaks=new Float32Array(n);for(const c of channels)for(let i=0;i<n;i++)peaks[i]=Math.max(peaks[i],Math.abs(c[i]));
  const deque=new Int32Array(window+2);let head=0,tail=0,right=0,gain=1,minGain=1;
  const cap=deque.length,release=Math.exp(-1/(rate*.08));
  for(let i=0;i<n;i++){
    while(head!==tail&&deque[head]<i)head=(head+1)%cap;
    while(right<n&&right<=i+window){while(head!==tail&&peaks[deque[(tail-1+cap)%cap]]<=peaks[right])tail=(tail-1+cap)%cap;deque[tail]=right++;tail=(tail+1)%cap;}
    const max=peaks[deque[head]],required=max>ceiling?ceiling/max:1;
    gain=required<gain?required:required+(gain-required)*release;minGain=Math.min(minGain,gain);
    for(const c of channels)c[i]=Math.max(-ceiling,Math.min(ceiling,c[i]*gain));
  }
  return {channels,reductionDb:-20*Math.log10(Math.max(minGain,1e-12))};
}
function pcm16(channel,start=0,end=channel.length){
  const a=new Int16Array(end-start);for(let i=start;i<end;i++){const x=Math.max(-1,Math.min(1,channel[i]));a[i-start]=Math.round(x*(x<0?32768:32767));}return a;
}
function wav24(channels,rate){
  const frames=channels[0].length,n=channels.length,size=frames*n*3,buffer=new ArrayBuffer(44+size+(size&1)),v=new DataView(buffer);
  const text=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,n,true);v.setUint32(24,rate,true);v.setUint32(28,rate*n*3,true);v.setUint16(32,n*3,true);v.setUint16(34,24,true);text(36,'data');v.setUint32(40,size,true);
  let p=44;for(let i=0;i<frames;i++)for(const c of channels){const x=Math.max(-1,Math.min(1,c[i])),s=Math.round(x*(x<0?8388608:8388607));v.setUint8(p++,s&255);v.setUint8(p++,(s>>8)&255);v.setUint8(p++,(s>>16)&255);}
  return buffer;
}

onmessage=e=>{
 try{
  const {action,channels,rate,ceiling,bitrate}=e.data;
  if(action==='finish'){
   const limited=limitPeaks(channels,rate,ceiling),stats=measure(limited.channels);
   postMessage({channels:limited.channels,stats,reductionDb:limited.reductionDb},limited.channels.map(c=>c.buffer));
  }else if(action==='wav'){
   const buffer=wav24(channels,rate);postMessage({buffer},[buffer]);
  }else if(action==='mp3'){
   importScripts('../../assets/vendor/lame.min.js');
   const encoder=new lamejs.Mp3Encoder(channels.length,rate,bitrate),parts=[];let bytes=0;
   const append=data=>{if(data.length){const p=new Uint8Array(data);parts.push(p);bytes+=p.length;}};
   for(let i=0;i<channels[0].length;i+=1152){const end=Math.min(i+1152,channels[0].length);append(encoder.encodeBuffer(pcm16(channels[0],i,end),channels.length===2?pcm16(channels[1],i,end):undefined));if(i%(1152*100)===0)postMessage({progress:i/channels[0].length});}
   append(encoder.flush());const buffer=new Uint8Array(bytes);let p=0;for(const part of parts){buffer.set(part,p);p+=part.length;}postMessage({buffer:buffer.buffer},[buffer.buffer]);
  }else throw Error('action');
 }catch{postMessage({error:true});}
};
