import 'dotenv/config';
import { db, transaction } from '../server/core.js';
import bcrypt from 'bcryptjs';

async function main(){
  const definitions=[
    {name:'Starter',monthlyPaise:99900,annualPaise:999000,limits:{doctors:2,staff:3,branches:1,patients:null,storageBytes:1073741824},features:{export:false,customBranding:false,advancedReports:false,advancedCommissions:false,prioritySupport:false}},
    {name:'Professional',monthlyPaise:199900,annualPaise:1999000,limits:{doctors:5,staff:10,branches:2,patients:null,storageBytes:10737418240},features:{export:true,customBranding:true,advancedReports:true,advancedCommissions:true,prioritySupport:false}},
    {name:'Enterprise',monthlyPaise:499900,annualPaise:4999000,limits:{doctors:null,staff:null,branches:null,patients:null,storageBytes:null},features:{export:true,customBranding:true,advancedReports:true,advancedCommissions:true,prioritySupport:true}},
  ];
  for(const data of definitions)await db.plan.upsert({where:{name:data.name},create:data,update:{}});
  await db.platformSettings.upsert({where:{id:'platform'},create:{data:{productName:'DentaFlow',supportEmail:'support@example.com',supportPhone:'',taxBps:0,defaultTrialDays:14,currency:'INR',termsUrl:'',privacyUrl:'',maintenanceNotice:''}},update:{}});
  const adminPassword=process.env.PLATFORM_ADMIN_PASSWORD;
  if(adminPassword){if(adminPassword.length<12)throw new Error('Admin password must contain at least 12 characters.');await db.user.upsert({where:{email:process.env.PLATFORM_ADMIN_EMAIL||'admin@example.com'},create:{email:process.env.PLATFORM_ADMIN_EMAIL||'admin@example.com',name:'Platform administrator',passwordHash:await bcrypt.hash(adminPassword,12),verified:true,platformAdmin:true},update:{}});}
  if(process.env.SEED_DEMO==='true'){
    if(process.env.NODE_ENV==='production')throw new Error('Demo seed is forbidden in production.');
    const pass=process.env.DEMO_PASSWORD;if(!pass||pass.length<12)throw new Error('Set DEMO_PASSWORD with at least 12 characters.');
    const plan=await db.plan.findUniqueOrThrow({where:{name:'Professional'}});
    for(const [slug,name,ownerEmail] of [['sunrise-dental','Sunrise Dental Clinic','owner@sunrise.test'],['smilecare','SmileCare Dental Studio','owner@smilecare.test']]){
      if(await db.tenant.findUnique({where:{slug}}))continue;
      await transaction(async tx=>{
        const tenant=await tx.tenant.create({data:{slug,name,ownerEmail,phone:'+91 98765 43210',settings:{timezone:'Asia/Kolkata',currency:'INR',address:'Guwahati, Assam',invoiceFooter:'Thank you for trusting us with your smile.',appointmentHours:'Mon–Sat · 9 am–6 pm'}}});
        const user=await tx.user.create({data:{email:ownerEmail,name:'Dr. Aditi Sharma',passwordHash:await bcrypt.hash(pass,12),verified:true}});await tx.membership.create({data:{userId:user.id,tenantId:tenant.id,role:'OWNER'}});await tx.subscription.create({data:{tenantId:tenant.id,planId:plan.id,endsAt:new Date(Date.now()+14*86400000)}});

        const branch=await tx.branch.create({data:{tenantId:tenant.id,name:'Main clinic',address:'Guwahati, Assam'}});
        const doctor=await tx.doctor.create({data:{tenantId:tenant.id,name:'Dr. Aditi Sharma',specialty:'Endodontist',commissionPercent:20,branchId:branch.id}});
        await tx.doctor.create({data:{tenantId:tenant.id,name:'Dr. Rohan Das',specialty:'General Dentistry',commissionPercent:15,branchId:branch.id}});
        for(const [i,patientName] of ['Ananya Das','Rahul Mehta','Priya Sharma','Arjun Bora','Neha Singh','Vikram Roy'].entries()){
          const patient=await tx.patient.create({data:{tenantId:tenant.id,name:patientName,phone:`98765432${10+i}`,gender:i%2?'Male':'Female',consent:true}});
          const today=new Date();today.setHours(9+i,0,0,0);
          await tx.appointment.create({data:{tenantId:tenant.id,patientId:patient.id,doctorId:doctor.id,branchId:branch.id,startsAt:today,reason:['Consultation','Root canal · Session 2','Scaling & polishing','Crown fitting','Follow-up','Consultation'][i],status:i===0?'COMPLETED':i===1?'CHECKED_IN':'SCHEDULED'}});
          await tx.invoice.create({data:{tenantId:tenant.id,patientId:patient.id,description:'Consultation & treatment',totalPaise:100000+i*50000}});
        }
        for(const [name,pricePaise,sessions] of [['Consultation',50000,1],['Scaling & polishing',150000,1],['Root canal treatment',600000,3],['Dental crown',800000,2]] as const)await tx.catalogItem.create({data:{tenantId:tenant.id,name,pricePaise,sessions}});
      });
    }
  }
  console.log('Seed complete. Existing prices and accounts were preserved.');
}
main().finally(()=>db.$disconnect());
